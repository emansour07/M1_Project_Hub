import {receivedSnapshot,validateReceived} from './received.mjs';
import {operationsRoute} from './operations.mjs';
import {reminderSettings,saveReminderSettings} from './reminders.mjs';
import {RequirementsStore,schema,permitted} from './requirements.mjs';
import {assetCompleteness} from './completeness.mjs';

import {editorIdentity,editorList,saveEditors,startEditorLogin,finishEditorLogin,logoutEditor,canEditRow,canEditField} from './editor-auth.mjs';

import {readDrafts,saveDraft,getDraft,updateDraftState,protectedColumn} from './tracker-drafts.mjs';

import {preparePublication,publishDraft} from './tracker-publish.mjs';

import {originalSnapshot,syncOriginals} from './originals.mjs';



import {contentSnapshot,saveContent} from './content.mjs';

import {trackerSnapshot} from './tracker.mjs';



import {getScope,scopedFile,pruneScopeCache,scopeStatus} from './scope.mjs';

import {checkSharedFiles} from './checker.mjs';
import {formatSnapshot,formatStatus,syncFormats} from './format-audit.mjs';



import {createHandler,stored,validateSnapshot} from './worker.mjs';

import {syncForma} from './forma.mjs';

import {saveBaseline} from './models.mjs';

import {syncProgress,syncModelSources,progressSnapshot,progressStatus} from './progress.mjs';

import {validBaseline} from './model-core.mjs';

import {SQLiteStore} from './cloudflare/store.mjs';

import {checkSourceAccess,originalMidpSources,downloadWorkbook,downloadItemWorkbook} from './sources.mjs';

import {syncWorkbook,workbookSnapshot,midpSnapshot,exportMidp} from './workbooks.mjs';

import {isOwner,sessionCookie,readLoginKey,readLoginForm,loginPage} from './cloudflare/auth.mjs';

import {OwnerCodeAuth,codePage,codeSavedPage} from './cloudflare/owner-code.mjs';





const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

const redirect=path=>new Response(null,{status:303,headers:{Location:path}});

async function limitedJson(request,max){const reader=request.body?.getReader();if(!reader)throw Error('No changes were supplied.');const chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('The changes are too large.');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));}

function secure(response){const h=new Headers(response.headers);h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');h.set('X-Frame-Options','DENY');if(!h.has('Referrer-Policy'))h.set('Referrer-Policy','no-referrer');return new Response(response.body,{status:response.status,headers:h});}

export class M1Application {

 constructor(storage,env,templates){this.templates=templates;this.storage=storage;this.env={...env,BUCKET:new SQLiteStore(storage),SQL:storage.sql};this.auth=new OwnerCodeAuth(storage.sql,env.M1_ADMIN_KEY);this.app=createHandler(templates.adminHtml,{schema:1,name:'Awaiting M1 reviews',reportAt:946684800000,reviews:[],voidCount:0,warnings:[]});}

 async fetch(request){let response;try{response=await this.handle(request);}catch{response=json({error:'Unable to update right now. Please try again shortly.'},503);}const origin=request.headers.get('Origin'),url=new URL(request.url);if(origin===this.env.FRONTEND_ORIGIN&&((request.method==='GET'&&['/api/received','/api/snapshot','/api/models','/api/knowledge','/api/midp','/api/midp/export','/api/tracker','/api/content','/api/originals','/api/checker','/api/completeness','/api/orgchart/image','/api/companies','/api/masterplans'].includes(url.pathname))||(request.method==='POST'&&['/api/received/refresh','/api/refresh','/api/models/refresh','/api/midp/refresh','/api/tracker/refresh','/api/originals/refresh'].includes(url.pathname)))){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');}return secure(response);}

 async handle(request){const {trackerEditorHtml,contentEditorHtml,remindersHtml}=this.templates;const env=this.env,url=new URL(request.url),path=url.pathname;

  if(path==='/api/received'&&request.method==='GET')return json(await receivedSnapshot(env));

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
  if(path==='/admin/received'&&request.method==='GET')return owner?new Response(this.templates.receivedImportHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}}):redirect('/admin/login');
  if(path==='/api/received/import'){
   if(!owner||request.method!=='PUT'||request.headers.get('Origin')!==url.origin)return json({error:'Owner access required.'},403);
   try{const data=validateReceived(await limitedJson(request,1500000),await getScope(env));await env.BUCKET.put('m1/received',JSON.stringify(data));return json({saved:true,count:data.rows.length});}catch(e){return json({error:e.message},400);}
  }

  const operations=await operationsRoute(this,request,owner);if(operations)return operations;

  if(path==='/requirements'&&request.method==='GET')return new Response(this.templates.requirementsHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}});
  if(path==='/api/requirements'||path.startsWith('/api/requirements/')){
   const user=await editorIdentity(env,request,owner);if(!user)return json({error:'Sign in with an approved Autodesk account.'},401);
   if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);
   const assets=(await getScope(env))?.rows||[],store=new RequirementsStore(this.storage);
   try{
    if(path==='/api/requirements'&&request.method==='GET')return json({user,assets:assets.filter(a=>user.owner||user.assets.includes('*')||user.assets.includes(a.id)).map(a=>({id:a.id,label:a.zone+' · '+a.name+' · '+(a.proposed||a.code)})),schema,rows:store.list(user,assets),dashboardUrl:env.FRONTEND_URL,ownerUrl:'/admin/login'});
    if(path==='/api/requirements'&&request.method==='POST')return json(store.save(user,await limitedJson(request,35000),assets));
    const match=/^\/api\/requirements\/([a-f0-9-]{36})(\/comments)?$/.exec(path);
    if(match){const row=store.get(match[1]);if(!row||!permitted(user,row.data)||row.data.scopeId!=='*'&&!assets.some(a=>a.id===row.data.scopeId))return json({error:'Requirement not found in your scope.'},404);
     if(!match[2]&&request.method==='GET')return json({row,events:store.events(row.id)});
     if(match[2]&&request.method==='POST')return json(store.comment(user,row.id,(await limitedJson(request,14000)).text,assets));
    }
    return json({error:'Action not available.'},405);
   }catch(e){return json({error:e.message},400);}
  }

  if(path==='/api/completeness'&&request.method==='GET')return json({assets:assetCompleteness((await midpSnapshot(env))?.entries||[])});

  if(path==='/auth/editor/login'&&request.method==='GET'){try{return await startEditorLogin(env,request);}catch(e){return json({error:owner?e.message:'Editor sign-in is temporarily unavailable.'},503);}}

  if(path==='/api/forma/callback'&&url.searchParams.get('state')?.startsWith('editor_')){try{return await finishEditorLogin(env,request);}catch(e){return new Response(e.message,{status:403,headers:{'Content-Type':'text/plain'}});}}

  if(path==='/editor'||path==='/admin/editors'){if(path==='/admin/editors'&&!owner)return redirect('/admin/login');return new Response(trackerEditorHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}});}

  if(path.startsWith('/api/editor/')||path==='/auth/editor/logout'){

   const user=await editorIdentity(env,request,owner);if(!user)return json({error:'Sign in with an approved Autodesk account to edit.'},401);

   if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);

   try{

    if(path==='/auth/editor/logout'&&request.method==='POST')return logoutEditor(env,request);

    if(path==='/api/editor/workspace'&&request.method==='GET'){const tracker=await trackerSnapshot(env);tracker.rows=tracker.rows.filter(r=>canEditRow(user,r));const scope=await getScope(env);return json({user,tracker,editableFields:tracker.columns.filter(c=>!protectedColumn(c)&&canEditField(user,c.key)).map(c=>c.key),drafts:readDrafts(env,user),editors:user.owner?await editorList(env):null,assets:(scope?.rows||[]).map(r=>({id:r.id,label:r.zone+' · '+r.name+' · '+(r.proposed||r.code)})),disciplines:[...new Set(tracker.rows.map(r=>r.discipline))].sort()});}

    if(path==='/api/editor/access'&&request.method==='PUT'&&user.owner){const scope=await getScope(env),tracker=await trackerSnapshot(env);return json(await saveEditors(env,await limitedJson(request,100000),(scope?.rows||[]).map(r=>r.id),tracker.columns.filter(c=>!protectedColumn(c)).map(c=>c.key)));}

    if(path==='/api/editor/drafts'&&request.method==='POST')return json(await saveDraft(env,user,await limitedJson(request,150000)));

    if(path==='/api/editor/preview'&&request.method==='GET'&&user.owner){const output=await preparePublication(env,url.searchParams.get('id'),user);return new Response(output.bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="M1_Tracker_Proposed.xlsx"'}});}

    if(path==='/api/editor/publish'&&request.method==='POST'&&user.owner)return json(await publishDraft(env,(await limitedJson(request,5000)).id,user));

    if(path==='/api/editor/reject'&&request.method==='POST'&&user.owner){const draft=getDraft(env,(await limitedJson(request,5000)).id);if(draft.status!=='pending')throw Error('Only pending drafts can be rejected.');return json(updateDraftState(env,draft,'rejected'));}

    return json({error:'This action is not permitted.'},403);

   }catch(e){return json({error:e.message},400);}

  }

  if(path==='/api/checker'&&request.method==='GET'){const [audit,mapping,policy]=await Promise.all([formatSnapshot(env),workbookSnapshot(env,'tidp'),getScope(env)]);const files=(audit?.files||[]).map(f=>scopedFile(f,policy)).filter(Boolean);return json({checkedAt:audit?.checkedAt||null,rows:checkSharedFiles(files,mapping?.rows,mapping?.naming)});}

  if(path==='/api/originals'&&request.method==='GET')return json(await originalSnapshot(env));

  if(path==='/api/originals/refresh'){if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);const lock='m1/original-refresh',old=await(await env.BUCKET.get(lock))?.json();if(old?.until>Date.now())return json({updating:true});await env.BUCKET.put(lock,JSON.stringify({until:Date.now()+60000}));try{return json(await syncOriginals(env));}catch(e){return json({error:owner?e.message:'Original model checklist could not be refreshed.'},503);}}

  if(path==='/api/models/access'&&request.method==='GET')return owner?json({...await checkSourceAccess(env),progress:await (await env.BUCKET.get('m1/progress/state'))?.json()}):json({error:'Owner access required.'},403);

  if(path==='/api/models/status'&&request.method==='GET')return owner?json({...await progressStatus(env),formatAudit:await formatStatus(env)}):json({error:'Owner access required.'},403);

  if(path==='/admin/reminders'){if(!owner)return redirect('/admin/login');return new Response(remindersHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}});}
  if(path==='/api/admin/reminders'){if(!owner)return json({error:'Owner access required.'},403);if(request.method==='GET')return json(await reminderSettings(env));if(request.method!=='PUT'||request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);try{return json(await saveReminderSettings(env,await limitedJson(request,30000)));}catch(e){return json({error:e.message},400);}}

  if(path==='/admin/content'){if(!owner)return redirect('/admin/login');return new Response(contentEditorHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}});}

  if(path==='/api/content'){

   if(request.method==='GET')return json(await contentSnapshot(env));

   if(request.method!=='PUT'||!owner||request.headers.get('Origin')!==url.origin)return json({error:'Owner access required.'},403);

   try{const input=await limitedJson(request,150000);return json(await saveContent(env,input));}catch(e){return json({error:e.message},e.status||400);}

  }

  if(path==='/admin/source-files'){if(!owner)return redirect('/admin/login');return new Response('<!doctype html><title>M1 source workbooks</title><h1>M1 source workbooks</h1>'+[0,1,2,3].map(i=>'<p><a href="/api/source-file?index='+i+'">Original MIDP '+(i+1)+'</a></p>').join('')+'<p><a href="/api/source-file?index=tracker">Progress tracker</a></p>',{headers:{'Content-Type':'text/html'}});}

  if(path==='/api/source-file'&&request.method==='GET'){if(!owner)return json({error:'Owner access required.'},403);try{const index=url.searchParams.get('index');let data;if(index==='tracker')data=await downloadWorkbook(env,'tracker');else{if(!/^[0-3]$/.test(index||''))return json({error:'Invalid source.'},400);const list=await originalMidpSources(env);if(list.length!==4)throw Error('Expected four source MIDPs.');data=await downloadItemWorkbook(env,list[Number(index)].id);}return new Response(data.bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+data.source.name.replace(/[^A-Za-z0-9._-]/g,'_')+'"'}});}catch(e){return json({error:e.message},503);}}

  if(path==='/api/original-midps/sources'&&request.method==='GET')return json({sources:await originalMidpSources(env)});

  if(path==='/api/tracker'&&request.method==='GET')return json(await trackerSnapshot(env));

  if(path==='/api/tracker/refresh'){

   if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);

   const lock='m1/tracker-refresh',old=await(await env.BUCKET.get(lock))?.json();if(old?.until>Date.now())return json({updating:true});await env.BUCKET.put(lock,JSON.stringify({until:Date.now()+60000}));await syncWorkbook(env,'tracker');return json({ok:true});

  }

  if(path==='/api/knowledge'&&request.method==='GET')return json({mapping:await getScope(env)?await workbookSnapshot(env,'tidp'):null,scope:await getScope(env)});

  if(path==='/api/midp'&&request.method==='GET')return json(await midpSnapshot(env)||{entries:[],total:0,dated:0,source:null});

  if(path==='/api/midp/export'&&request.method==='GET'){

   try{const out=await exportMidp(env,url.searchParams.get('start'),url.searchParams.get('end'),Object.fromEntries(['category','asset','discipline','originator','format','approval','q'].map(k=>[k,url.searchParams.get(k)||''])));return new Response(out.bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="M1_MIDP_'+url.searchParams.get('start')+'_'+url.searchParams.get('end')+'.xlsx"'}});}catch(e){return json({error:e.message},400);}

  }

  if(path==='/api/midp/refresh'){

   if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);

   const last=await(await env.BUCKET.get('m1/midp/refresh-lock'))?.json();if(last?.until>Date.now())return json({updating:true});await env.BUCKET.put('m1/midp/refresh-lock',JSON.stringify({until:Date.now()+60000}));await syncWorkbook(env,'midp');return json({ok:true});

  }

  if(path==='/api/scope/status'&&request.method==='GET')return owner?json(await scopeStatus(env)):json({error:'Owner access required.'},403);

  if(path==='/api/scope/prune'&&request.method==='POST'){

   if(!owner||request.headers.get('Origin')!==url.origin)return json({error:'Owner access required.'},403);return json(await pruneScopeCache(env,1000));

  }

  if(path==='/api/workbooks/sync'){

   if(!owner||request.method!=='POST'||request.headers.get('Origin')!==url.origin)return json({error:'Owner access required.'},403);

   const result=[];for(const key of ['scope','tidp','tracker','midp']){try{const data=await syncWorkbook(env,key);result.push({source:key,ok:true,rows:data.rows.length});}catch(e){result.push({source:key,ok:false,error:e.message});}}

   await pruneScopeCache(env,1000);return json({results:result});

  }

  if(path==='/admin/code'){

   if(!owner)return redirect('/admin/login');

   if(request.method==='GET')return new Response(codePage(),{headers:{'Content-Type':'text/html;charset=utf-8','Referrer-Policy':'same-origin'}});

   if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);

   const form=await readLoginForm(request),code=form instanceof URLSearchParams?form.get('code')||'':'';

   if(code!==form.get?.('confirm')||code.length<8||code.length>128||!code.trim())return json({error:'Enter the same 8â€“128 character code twice.'},400);

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

  if(path==='/api/received/refresh'){
   if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);
   return json(await syncProgress(env,true));
  }
  if(path==='/api/models/refresh'){

   if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);

   return json(await syncFormats(env,undefined,undefined,36));

  }

  if(path==='/api/refresh'){

   if(request.method!=='POST'||![url.origin,env.FRONTEND_ORIGIN].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);

   // Sequential: both tasks share the encrypted Autodesk token. Max 40 provider reads plus token refresh.

   await pruneScopeCache(env,500);const results=[];for(const task of [()=>env.REVIEWS_ACCESS_VERIFIED==='true'?syncForma(env,stored,validateSnapshot,true):Promise.resolve({skipped:true}),()=>syncModelSources(env,true)]){try{results.push(await task());}catch{results.push({error:true});}}

   if(results.every(r=>r.error))return json({error:'Unable to update right now.'},503);return json({updating:results.some(r=>r.updating),partialFailure:results.some(r=>r.error)});

  }

  if(path==='/admin'&&!owner)return redirect('/admin/login');

  const headers=new Headers(request.headers);for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('oai-'))headers.delete(key);

  if(owner){headers.set('oai-authenticated-user-id','m1-owner');headers.set('oai-authenticated-user-email',env.M1_UPLOADER_EMAIL);}

  if(path==='/admin')url.pathname='/';

  const response=await this.app.fetch(new Request(new Request(url,request),{headers}),env);

  if(path==='/api/forma/callback'&&response.status===303){const h=new Headers(response.headers);if(h.get('Location')?.startsWith('/?forma='))h.set('Location','/admin'+h.get('Location').slice(1));return new Response(response.body,{status:303,headers:h});}return response;

 }

 async tick(){if(this.env.FORMA_SYNC_ENABLED!=='true')return;await syncOriginals(this.env).catch(()=>{});await pruneScopeCache(this.env,500).catch(()=>{});const scopeSource=await workbookSnapshot(this.env,'scope'),policy=await getScope(this.env);if(scopeSource&&scopeSource.source.version!==policy?.source.version)await syncWorkbook(this.env,'tidp').catch(()=>{});if(this.env.REVIEWS_ACCESS_VERIFIED==='true')await syncForma(this.env,stored,validateSnapshot).catch(()=>{});await syncModelSources(this.env).catch(()=>{});for(const key of ['scope','tidp','tracker','midp']){const saved=await workbookSnapshot(this.env,key);if(!saved||Date.now()-saved.source.checkedAt>900000){await syncWorkbook(this.env,key).catch(()=>{});break;}}}

}
