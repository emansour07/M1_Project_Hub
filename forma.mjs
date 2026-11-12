import {serviceAccessToken,serviceConfigured} from './ssa.mjs';
// Autodesk Reviews integration. All provider calls and credentials remain server-side.
const project=env=>{const id=String(env.ACC_PROJECT_ID||'').replace(/^b\./,'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Configure the M1 project first.');return id;};
const FROOT='m1/forma/', API='https://developer.api.autodesk.com', PERIOD=300000;
const fj=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const txt=v=>typeof v==='string'?v.trim():v==null?'':String(v);
const epoch=v=>{if(!v)return null;const n=Date.parse(v);if(!Number.isFinite(n))throw Error('Invalid Autodesk date.');return n;};
const enc=new TextEncoder();
function configured(env){if(env.APS_AUTH_MODE==='ssa')return serviceConfigured(env);return ['APS_CLIENT_ID','APS_CLIENT_SECRET','APS_CALLBACK_URL','APS_TOKEN_KEY','ACC_PROJECT_ID'].every(k=>!!env[k]);}
async function readF(env,key){const o=await env.BUCKET.get(FROOT+key);return o?{value:await o.json(),etag:o.etag}:null;}
async function putF(env,key,value,etag){return env.BUCKET.put(FROOT+key,JSON.stringify(value),etag?{onlyIf:{etagMatches:etag}}:{});}
async function aes(env){const raw=Uint8Array.from(atob(env.APS_TOKEN_KEY),c=>c.charCodeAt(0));if(raw.length!==32)throw Error('Invalid token encryption key.');return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
async function seal(env,value){const iv=crypto.getRandomValues(new Uint8Array(12)),body=await crypto.subtle.encrypt({name:'AES-GCM',iv},await aes(env),enc.encode(JSON.stringify(value)));return {iv:b64(iv),body:b64(body)};}
async function unseal(env,value){const from=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from(value.iv)},await aes(env),from(value.body))));}
async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function tokenRequest(env,body){
 const r=await fetch(API+'/authentication/v2/token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Basic '+btoa(env.APS_CLIENT_ID+':'+env.APS_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
 if(!r.ok)throw Error('Autodesk authorization failed. Reconnect Autodesk or check the application settings.');
 const t=await r.json();if(!t.access_token||!t.refresh_token||!Number.isFinite(t.expires_in))throw Error('Invalid Autodesk token response.');
 return {...t,expiresAt:Date.now()+t.expires_in*1000};
}
export async function accessToken(env){if(env.APS_AUTH_MODE==='ssa')return serviceAccessToken(env,seal,unseal);const saved=await readF(env,'tokens');if(!saved)throw Error('Autodesk is not connected.');let t=await unseal(env,saved.value);if(t.expiresAt<Date.now()+120000){t=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:t.refresh_token});if(!await putF(env,'tokens',await seal(env,t),saved.etag))throw Error('Connection changed. Retry synchronization.');}return t.access_token;}
export async function getAPS(path,token){
 const r=await fetch(API+path,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok){const e=new Error(r.status===429?'Autodesk request limit reached. The previous snapshot is retained.':r.status===403?'Autodesk denied project access. Ask the Account Admin to register the Client ID in Custom Integrations.':r.status===401?'Autodesk authorization expired. Reconnect Autodesk.':'Autodesk review retrieval failed. The previous snapshot is retained.');e.status=r.status;try{const detail=await r.json();e.providerError=JSON.stringify(detail.errors||detail.errorCode||detail.developerMessage||detail.message||{}).slice(0,800);}catch{}throw e;}
 return r.json();
}
export async function listAPS(path,token,read=getAPS){
 const rows=[],seen=new Set();let offset=0;
 for(let page=0;page<400;page++){
  const d=await read(path+(path.includes('?')?'&':'?')+'limit=50&offset='+offset,token);
  if(!Array.isArray(d.results))throw Error('Invalid Autodesk response.');
  for(const r of d.results){const id=r.id||r.urn;if(!id||seen.has(id))throw Error('Incomplete or duplicate Autodesk page.');seen.add(id);rows.push(r);}
  const total=d.pagination?.totalResults;
  if(total!=null&&(!Number.isInteger(total)||total<0))throw Error('Invalid Autodesk pagination.');
  offset+=d.results.length;
  if(total!=null&&offset===total)return rows;
  if(total!=null&&offset>total)throw Error('Autodesk records changed during synchronization. Retry.');
  if(d.results.length===0){if(total!=null&&offset<total)throw Error('Incomplete Autodesk page.');return rows;}
  if(total==null&&d.results.length<50&&!d.pagination?.nextUrl)return rows;
 }
 throw Error('Autodesk project exceeds the synchronization limit.');
}
export function mapFormaReview(r,w,versions){
 if(!r.id||!r.sequenceId||!r.name||!r.status||!w.name||!Array.isArray(w.steps))throw Error('Invalid Autodesk review fields.');
 const step=w.steps.find(s=>s.id===r.currentStepId),next=r.nextActionBy||{},c=next.candidates||{};
 const people=[...(next.claimedBy||[]),...(c.users||[]),...(c.roles||[]),...(c.companies||[])].map(v=>txt(v.name)||txt(v.autodeskId)).filter(Boolean);
 const workflow=txt(w.name),s=workflow.toUpperCase();
 const discipline=/(?:^|_)(ARC|ARCH)(?:_|$)/.test(s)?'Architecture':/(?:^|_)STR?(?:_|$)/.test(s)?'Structure':/(?:^|_)(MECH?|MEC)(?:_|$)/.test(s)?'Mechanical':/(?:^|_)ELEC?(?:_|$)/.test(s)?'Electrical':/(?:^|_)(CIV|CVL)(?:_|$)/.test(s)?'Civil':/(?:^|_)MARINE(?:_|$)/.test(s)?'Marine':/(?:^|_)GEO(?:_|$)/.test(s)?'Geotechnical':/(?:^|_)(ROD|ROADS)(?:_|$)/.test(s)?'Roads':/(?:^|_)UTL(?:_|$)/.test(s)?'Utilities':workflow;
 return {id:String(r.sequenceId),autodeskId:r.id,round:'—',status:txt(r.status).toUpperCase(),name:txt(r.name),workflow,discipline,owner:[...new Set(people)].join(', '),initiator:txt(r.createdBy?.name),approver:txt(r.approvedBy?.name),due:epoch(r.currentStepDueDate),created:epoch(r.createdAt),finished:epoch(r.finishedAt),step:step?.name||(r.status==='CLOSED'?'Review closed':'Step not supplied'),steps:w.steps.length,progress:'',files:versions.map(f=>({name:txt(f.reviewContent?.name||f.name),path:'',version:txt(f.urn?.match(/[?&]version=(\d+)/)?.[1]),status:txt(f.approveStatus?.label),comments:'',description:''}))};
}
async function lease(env,duration=600000){const old=await readF(env,'lease');if(old?.value.until>Date.now())return null;const id=crypto.randomUUID();const saved=await env.BUCKET.put(FROOT+'lease',JSON.stringify({id,until:Date.now()+duration}),{onlyIf:old?{etagMatches:old.etag}:new Headers({'If-None-Match':'*'})});return saved?{id,etag:saved.etag}:null;}
async function release(env,l){await putF(env,'lease',{id:l.id,until:0},l.etag);}
export async function syncForma(env,readSnapshot,validate,manual=false){
 if(env.FORMA_BATCHED==='true')return syncFormaBatched(env,readSnapshot,validate,manual);
 if(!configured(env)||!env.BUCKET)throw Error('Autodesk application setup is incomplete.');
 const l=await lease(env);if(!l)return {skipped:true,updating:true,reason:'An update is in progress.'};
 try{
  const state=(await readF(env,'status'))?.value||{};
  const nextAllowed=manual&&!state.error?(state.lastAttemptAt||0)+60000:state.nextAttemptAt||0;
  if(nextAllowed>Date.now())return {skipped:true,retryAfterMs:nextAllowed-Date.now(),reason:'Latest saved update loaded.'};
  await putF(env,'status',{...state,lastAttemptAt:Date.now(),nextAttemptAt:Date.now()+PERIOD});
  const before=await readSnapshot(env),token=await accessToken(env),base='/construction/reviews/v1/projects/'+project(env);
  const raw=await listAPS(base+'/reviews?sort=sequenceId%20asc',token),reviews=[];let voidCount=0;
  const deadline=Date.now()+180000;
  for(const r of raw){if(Date.now()>deadline)throw Error('Synchronization time limit reached. The previous snapshot is retained.');if(/\bVOID(?:ED)?\b/i.test(r.status)){voidCount++;continue;}const path=base+'/reviews/'+encodeURIComponent(r.id);const w=await getAPS(path+'/workflow',token),files=await listAPS(path+'/versions',token);reviews.push(mapFormaReview(r,w,files));}
  if(!reviews.length&&before.data.current.reviews.length)throw Error('Autodesk returned no non-void reviews. The previous snapshot is retained for verification.');
  const now=Date.now(),current=validate({schema:1,name:'Autodesk Forma · M1 Reviews',project:project(env),source:'forma',reportAt:now,loadedAt:now,reviews,voidCount,uniqueCount:raw.length,warnings:['Forma returns the latest review round. Round number and document comments are not supplied by this connection. Archived reviews are excluded.']});
  const same=JSON.stringify(reviews)===JSON.stringify(before.data.current.reviews),value={revision:before.data.revision+1,current,previous:same?before.data.previous:before.data.current,updatedAt:now};
  const saved=await env.BUCKET.put('m1/shared-snapshot-v2.json',JSON.stringify(value),{onlyIf:before.etag?{etagMatches:before.etag}:new Headers({'If-None-Match':'*'})});
  if(!saved)throw Error('The shared report changed during synchronization. Retry.');
  await putF(env,'status',{connected:true,lastSuccessAt:now,lastAttemptAt:now,nextAttemptAt:now+PERIOD,error:null});
  return {ok:true,reviewCount:reviews.length,lastSuccessAt:now};
 }catch(e){const old=(await readF(env,'status'))?.value||{};await putF(env,'status',{...old,error:e.message,lastAttemptAt:Date.now(),nextAttemptAt:Date.now()+(e.status===429?900000:PERIOD)});throw e;}finally{await release(env,l);}
}
// One invocation performs at most 20 provider reads. A staged job survives
// between viewer requests or minute ticks; only complete jobs are published.
function appendPage(target,data,max){
 if(!Array.isArray(data.results))throw Error('Invalid Autodesk response.');
 const seen=new Set(target.map(v=>v.id||v.urn));
 for(const value of data.results){const id=value.id||value.urn;if(!id||seen.has(id))throw Error('Incomplete or duplicate Autodesk page.');seen.add(id);target.push(value);}
 if(target.length>max)throw Error('Autodesk project exceeds the synchronization limit.');
 const total=data.pagination?.totalResults;
 if(total!=null&&(!Number.isInteger(total)||total<0||target.length>total))throw Error('Invalid Autodesk pagination.');
 const done=total!=null?target.length===total:data.results.length<50&&!data.pagination?.nextUrl;
 if(!done&&!data.results.length)throw Error('Incomplete Autodesk page.');
 return done;
}
async function syncFormaBatched(env,readSnapshot,validate,manual){
 if(!configured(env)||!env.BUCKET)throw Error('Autodesk application setup is incomplete.');
 const l=await lease(env,120000);if(!l)return {skipped:true,updating:true};
 let job;
 try{
  const state=(await readF(env,'status'))?.value||{};
  job=(await readF(env,'job'))?.value;
  if(job?.active&&Date.now()-job.startedAt>1200000)throw Error('The update expired. Retry synchronization.');
  if(!job?.active){
   const next=manual&&!state.error?(state.lastAttemptAt||0)+60000:state.nextAttemptAt||0;
   if(next>Date.now())return {skipped:true,retryAfterMs:next-Date.now()};
   const before=await readSnapshot(env),now=Date.now();
   job={active:true,startedAt:now,baseEtag:before.etag,raw:[],mapped:[],listDone:false,index:0,pending:null,voidCount:0};
   await putF(env,'status',{...state,lastAttemptAt:now,nextAttemptAt:now+PERIOD,error:null});
  }
  const token=await accessToken(env),base='/construction/reviews/v1/projects/'+project(env);
  let reads=0;const deadline=Date.now()+40000;
  while(reads<20&&Date.now()<deadline){
   if(!job.listDone){
    const data=await getAPS(base+'/reviews?sort=sequenceId%20asc&limit=50&offset='+job.raw.length,token);reads++;
    job.listDone=appendPage(job.raw,data,20000);continue;
   }
   if(job.index===job.raw.length)break;
   const review=job.raw[job.index];
   if(/\bVOID(?:ED)?\b/i.test(review.status)){job.voidCount++;job.index++;continue;}
   const path=base+'/reviews/'+encodeURIComponent(review.id);
   if(!job.pending){job.pending={workflow:await getAPS(path+'/workflow',token),files:[]};reads++;continue;}
   const data=await getAPS(path+'/versions?limit=50&offset='+job.pending.files.length,token);reads++;
   if(appendPage(job.pending.files,data,10000)){
    job.mapped.push(mapFormaReview(review,job.pending.workflow,job.pending.files));job.index++;job.pending=null;
   }
  }
  if(!job.listDone||job.index<job.raw.length){await putF(env,'job',job);return {updating:true,skipped:false,retryAfterMs:800};}
  const before=await readSnapshot(env);
  if(before.etag!==job.baseEtag)throw Error('The shared report changed during synchronization. Retry.');
  if(!job.mapped.length&&before.data.current.reviews.length)throw Error('Autodesk returned no non-void reviews. The previous report is retained.');
  const now=Date.now(),current=validate({schema:1,name:'Autodesk Forma · M1 Reviews',project:project(env),source:'forma',reportAt:now,loadedAt:now,reviews:job.mapped,voidCount:job.voidCount,uniqueCount:job.raw.length,warnings:[]});
  const same=JSON.stringify(current.reviews)===JSON.stringify(before.data.current.reviews);
  const value={revision:before.data.revision+1,current,previous:same?before.data.previous:before.data.current,updatedAt:now};
  const saved=await env.BUCKET.put('m1/shared-snapshot-v2.json',JSON.stringify(value),{onlyIf:before.etag?{etagMatches:before.etag}:new Headers({'If-None-Match':'*'})});
  if(!saved)throw Error('Another update was saved first. Retry synchronization.');
  await putF(env,'job',{active:false});
  await putF(env,'status',{connected:true,lastSuccessAt:now,lastAttemptAt:job.startedAt,nextAttemptAt:job.startedAt+PERIOD,error:null});
  return {ok:true,reviewCount:current.reviews.length,lastSuccessAt:now};
 }catch(e){
  await putF(env,'job',{active:false});
  const old=(await readF(env,'status'))?.value||{};
  await putF(env,'status',{...old,error:e.message,lastAttemptAt:Date.now(),nextAttemptAt:Date.now()+(e.status===429?900000:PERIOD)});throw e;
 }finally{await release(env,l);}
}
export async function formaRoutes(request,env,owner,readSnapshot,validate){
 const u=new URL(request.url),path=u.pathname;
 if(!path.startsWith('/api/forma/'))return null;
 if(path==='/api/forma/status'&&request.method==='GET'){
  const state=env.BUCKET?(await readF(env,'status'))?.value||{}:{};
  const tokens=env.APS_AUTH_MODE==='ssa'?serviceConfigured(env):env.BUCKET?!!await readF(env,'tokens'):false;
  return fj({configured:configured(env),connected:tokens,projectId:project(env),lastSuccessAt:state.lastSuccessAt||null,lastAttemptAt:state.lastAttemptAt||null,error:state.error||null,intervalMinutes:5,...(owner?{callbackUrl:u.origin+'/api/forma/callback',schedulerConfigured:!!env.M1_SYNC_SECRET}: {})});
 }
 if(path==='/api/forma/refresh'&&request.method==='POST'){
  if(![u.origin,'https://emansour07.github.io'].includes(request.headers.get('Origin')))return fj({error:'Refresh is unavailable from this page.'},403);
  if(!configured(env)||!env.BUCKET||!await readF(env,'tokens'))return fj({skipped:true,available:false});
  try{const result=await syncForma(env,readSnapshot,validate,true);return fj({ok:!!result.ok,skipped:!!result.skipped,updating:!!result.updating,lastSuccessAt:result.lastSuccessAt||null,retryAfterMs:result.retryAfterMs||0});}
  catch{return fj({error:'Unable to update right now. Your last saved reviews are still available.'},503);}
 }
 if(path==='/api/forma/sync'&&request.method==='POST'){
  const bearer=request.headers.get('Authorization')||'',service=!!env.M1_SYNC_SECRET&&await hash(bearer)===await hash('Bearer '+env.M1_SYNC_SECRET);
  if(!service&&(!owner||request.headers.get('Origin')!==u.origin))return fj({error:'Owner or scheduler authorization required.'},403);
  try{return fj(await syncForma(env,readSnapshot,validate));}catch(e){return fj({error:e.message},503);}
 }
 if(!owner)return fj({error:'Owner access required.'},403);
 if(env.APS_AUTH_MODE==='ssa')return fj({error:'M1 uses its project service account. Personal Autodesk sign-in is disabled.'},409);
 if(!configured(env)||!env.BUCKET)return fj({error:'Autodesk application setup is incomplete. Configure the application credentials before connecting.'},503);
 if(env.APS_CALLBACK_URL!==u.origin+'/api/forma/callback')return fj({error:'The Autodesk callback URL does not match this site.'},503);
 if(path==='/api/forma/connect'&&request.method==='POST'){
  if(request.headers.get('Origin')!==u.origin)return fj({error:'Invalid request origin.'},403);
  const state=crypto.randomUUID()+crypto.randomUUID(),key='oauth/'+await hash(state);
  await putF(env,key,{owner:request.headers.get('oai-authenticated-user-id'),expires:Date.now()+600000,used:false});
  const params=new URLSearchParams({response_type:'code',client_id:env.APS_CLIENT_ID,redirect_uri:env.APS_CALLBACK_URL,scope:'data:read',state});
  return fj({url:API+'/authentication/v2/authorize?'+params});
 }
 if(path==='/api/forma/callback'&&request.method==='GET'){
  const state=u.searchParams.get('state')||'';if(state.length>200||!state)return fj({error:'Invalid Autodesk sign-in state.'},400);
  const key='oauth/'+await hash(state),stored=await readF(env,key);
  if(!stored||stored.value.used||stored.value.expires<Date.now()||stored.value.owner!==request.headers.get('oai-authenticated-user-id'))return fj({error:'Autodesk sign-in expired. Start again from the dashboard.'},400);
  if(!await putF(env,key,{...stored.value,used:true},stored.etag))return fj({error:'Autodesk sign-in was already processed.'},400);
  if(u.searchParams.has('error'))return new Response(null,{status:303,headers:{Location:'/?forma=cancelled','Cache-Control':'no-store'}});
  const l=await lease(env);if(!l)return fj({error:'A synchronization is running. Retry connecting shortly.'},409);
  try{const code=u.searchParams.get('code');if(!code||code.length>4096)return fj({error:'Invalid Autodesk authorization code.'},400);const token=await tokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:env.APS_CALLBACK_URL});await putF(env,'tokens',await seal(env,token));await putF(env,'job',{active:false});await putF(env,'status',{connected:true,error:null,nextAttemptAt:0});return new Response(null,{status:303,headers:{Location:'/?forma=connected','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}catch(e){return fj({error:e.message},503);}finally{await release(env,l);}
 }
 return fj({error:'Method or route not supported.'},405);
}

