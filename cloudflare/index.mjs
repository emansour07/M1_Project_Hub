import {formatStatus} from '../format-audit.mjs';
import {DurableObject} from 'cloudflare:workers';
import {createHandler,stored,validateSnapshot} from '../worker.mjs';
import {syncForma} from '../forma.mjs';
import {saveBaseline} from '../models.mjs';
import {syncModelSources,progressSnapshot,progressStatus} from '../progress.mjs';
import {validBaseline} from '../model-core.mjs';
import {SQLiteStore} from './store.mjs';
import {checkSourceAccess} from '../sources.mjs';
import {syncWorkbook,workbookSnapshot} from '../workbooks.mjs';
import {isOwner,sessionCookie,readLoginKey,readLoginForm,loginPage} from './auth.mjs';
import {OwnerCodeAuth,codePage,codeSavedPage} from './owner-code.mjs';
import adminHtml from './admin.html';
const app=createHandler(adminHtml,{schema:1,name:'Awaiting M1 reviews',reportAt:946684800000,reviews:[],voidCount:0,warnings:[]});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const redirect=path=>new Response(null,{status:303,headers:{Location:path}});
function secure(response){const h=new Headers(response.headers);h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');h.set('X-Frame-Options','DENY');if(!h.has('Referrer-Policy'))h.set('Referrer-Policy','no-referrer');return new Response(response.body,{status:response.status,headers:h});}
export class M1State extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.env={...env,BUCKET:new SQLiteStore(ctx.storage),SQL:ctx.storage.sql};this.auth=new OwnerCodeAuth(ctx.storage.sql,env.M1_ADMIN_KEY);}
 async fetch(request){let response;try{response=await this.handle(request);}catch{response=json({error:'Unable to update right now. Please try again shortly.'},503);}const origin=request.headers.get('Origin'),url=new URL(request.url);if(origin===this.env.FRONTEND_ORIGIN&&((request.method==='GET'&&['/api/snapshot','/api/models','/api/knowledge'].includes(url.pathname))||(request.method==='POST'&&url.pathname==='/api/refresh'))){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');}return secure(response);}
 async handle(request){const env=this.env,url=new URL(request.url),path=url.pathname;
  if(path==='/health')return json({ok:true,project:'M1'});
  if(path==='/')return env.FRONTEND_URL?redirect(env.FRONTEND_URL):new Response('M1 project setup is pending.',{headers:{'Content-Type':'text/plain'}});
  const credential=this.auth.record(),secret=this.auth.sessionSecret(credential);
  if(path==='/admin/setup'&&request.method==='GET'){
   // Private first-use link expires with its signed session and stops working as soon as an owner code is saved.
   if(credential)return redirect('/admin/login');
   const token=url.searchParams.get('token')||'';if(token.length>1500)return json({error:'Invalid setup link.'},403);
   const probe=new Request(url,{headers:{Cookie:'__Host-m1-owner='+token}});
   if(!await isOwner(probe,secret))return json({error:'This setup link has expired.'},403);
   return new Response(null,{status:303,headers:{Location:'/admin/code','Set-Cookie':'__Host-m1-owner='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200'}});
  }
  if(path==='/admin/login'){
   if(request.method==='GET')return new Response(loginPage(),{headers:{'Content-Type':'text/html;charset=utf-8','Referrer-Policy':'same-origin'}});
   if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);
   const retry=this.auth.attempt(request);if(retry)return json({error:'Please try again in 15 minutes.'},429);
   if(!await this.auth.verify(await readLoginKey(request),credential))return new Response(loginPage(true),{status:403,headers:{'Content-Type':'text/html;charset=utf-8','Referrer-Policy':'same-origin'}});
   return new Response(null,{status:303,headers:{Location:'/admin','Set-Cookie':await sessionCookie(secret,url.origin)}});
  }
  const owner=await isOwner(request,secret);
  if(path==='/api/models/access'&&request.method==='GET')return owner?json({...await checkSourceAccess(env),progress:await (await env.BUCKET.get('m1/progress/state'))?.json()}):json({error:'Owner access required.'},403);
  if(path==='/api/models/status'&&request.method==='GET')return owner?json({...await progressStatus(env),formatAudit:await formatStatus(env)}):json({error:'Owner access required.'},403);
  if(path==='/api/knowledge'&&request.method==='GET')return json({mapping:await workbookSnapshot(env,'tidp')});
  if(path==='/api/workbooks/sync'){
   if(!owner||request.method!=='POST'||request.headers.get('Origin')!==url.origin)return json({error:'Owner access required.'},403);
   const result=[];for(const key of ['tidp','tracker','midp']){try{const data=await syncWorkbook(env,key);result.push({source:key,ok:true,rows:data.rows.length});}catch(e){result.push({source:key,ok:false,error:e.message});}}
   return json({results:result});
  }
  if(path==='/admin/code'){
   if(!owner)return redirect('/admin/login');
   if(request.method==='GET')return new Response(codePage(),{headers:{'Content-Type':'text/html;charset=utf-8','Referrer-Policy':'same-origin'}});
   if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);
   const form=await readLoginForm(request),code=form instanceof URLSearchParams?form.get('code')||'':'';
   if(code!==form.get?.('confirm')||code.length<8||code.length>128||!code.trim())return json({error:'Enter the same 8–128 character code twice.'},400);
   const next=await this.auth.change(code,credential);if(!next)return json({error:'Please sign in again.'},409);
   return new Response(codeSavedPage(),{headers:{'Content-Type':'text/html;charset=utf-8','Set-Cookie':await sessionCookie(this.auth.sessionSecret(next),url.origin)}});
  }
  if(path==='/api/models'&&request.method==='GET')return json({baseline:{assets:[],disciplines:[],requirements:[]},...await progressSnapshot(env)});
  if(path==='/api/models/baseline'){
   if(!owner||request.method!=='PUT'||request.headers.get('Origin')!==url.origin)return json({error:'Owner access required.'},403);
   // Stream-bound reads prevent oversized requests from exhausting Worker memory.
   const reader=request.body?.getReader();if(!reader)return json({error:'Empty baseline.'},400);let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000){await reader.cancel();return json({error:'Baseline too large.'},413);}chunks.push(value);}
   try{const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const baseline=validBaseline(JSON.parse(new TextDecoder().decode(bytes)));await saveBaseline(env,baseline);return json({ok:true});}catch{return json({error:'Check the baseline format and required filenames.'},400);}
  }
  if(path==='/api/refresh'){
   if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);
   // Sequential: both tasks share the encrypted Autodesk token. Max 40 provider reads plus token refresh.
   const results=[];for(const task of [()=>env.REVIEWS_ACCESS_VERIFIED==='true'?syncForma(env,stored,validateSnapshot,true):Promise.resolve({skipped:true}),()=>syncModelSources(env,true)]){try{results.push(await task());}catch{results.push({error:true});}}
   if(results.every(r=>r.error))return json({error:'Unable to update right now.'},503);return json({updating:results.some(r=>r.updating),partialFailure:results.some(r=>r.error)});
  }
  if(path==='/admin'&&!owner)return redirect('/admin/login');
  const headers=new Headers(request.headers);for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('oai-'))headers.delete(key);
  if(owner){headers.set('oai-authenticated-user-id','m1-owner');headers.set('oai-authenticated-user-email',env.M1_UPLOADER_EMAIL);}
  if(path==='/admin')url.pathname='/';
  const response=await app.fetch(new Request(new Request(url,request),{headers}),env);
  if(path==='/api/forma/callback'&&response.status===303){const h=new Headers(response.headers);if(h.get('Location')?.startsWith('/?forma='))h.set('Location','/admin'+h.get('Location').slice(1));return new Response(response.body,{status:303,headers:h});}return response;
 }
 async tick(){if(this.env.FORMA_SYNC_ENABLED!=='true')return;if(this.env.REVIEWS_ACCESS_VERIFIED==='true')await syncForma(this.env,stored,validateSnapshot).catch(()=>{});await syncModelSources(this.env).catch(()=>{});for(const key of ['tidp','tracker','midp']){const saved=await workbookSnapshot(this.env,key);if(!saved||Date.now()-saved.source.checkedAt>900000){await syncWorkbook(this.env,key).catch(()=>{});break;}}}
}
const state=env=>env.PROJECT_STATE.get(env.PROJECT_STATE.idFromName('m1'));
export default {fetch:(request,env)=>state(env).fetch(request),scheduled:(event,env,ctx)=>ctx.waitUntil(state(env).tick())};
