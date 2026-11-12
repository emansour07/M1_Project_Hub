import {formaRoutes} from './forma.mjs';
export {stored,validateSnapshot};
const KEY='m1/shared-snapshot-v2.json';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function validateSnapshot(s){
 if(!s||s.schema!==1||!Array.isArray(s.reviews)||s.reviews.length>20000||!Number.isFinite(s.reportAt)||s.reportAt<946684800000||s.reportAt>Date.now()+86400000)throw Error('Invalid review snapshot or report timestamp.');
 if(typeof s.name!=='string'||s.name.length>500)throw Error('Invalid report name.');
 const ids=new Set();for(const r of s.reviews){if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('Duplicate or missing review IDs.');ids.add(r.id);for(const f of ['status','name','discipline','workflow','owner','initiator','step'])if(typeof r[f]!=='string'||r[f].length>20000)throw Error('Invalid review fields.');if(/\bVOID(?:ED)?\b/i.test(r.status))throw Error('Void reviews must be excluded.');if(!Array.isArray(r.files)||r.files.length>10000)throw Error('Invalid review details.');for(const f of r.files)for(const k of ['name','status','path','comments','version'])if(typeof f[k]!=='string'||f[k].length>100000)throw Error('Invalid detail fields.');for(const k of ['due','created','finished'])if(r[k]!==null&&!Number.isFinite(r[k]))throw Error('Invalid date field.');}
 if(!Array.isArray(s.warnings)||!s.warnings.every(w=>typeof w==='string'))throw Error('Invalid validation messages.');return s;
}
async function stored(env){const object=await env.BUCKET.get(KEY);if(object)return {data:await object.json(),etag:object.etag};return {data:{revision:0,current:INITIAL,previous:null,updatedAt:null},etag:null};}
export function createHandler(page,initial){HTML=page;INITIAL=initial;return handler;}
let HTML='',INITIAL=null;
export const handler={async fetch(request,env){
 const url=new URL(request.url),api=url.pathname.startsWith('/api/');
 if(url.pathname==='/health')return json({ok:true});
 const id=request.headers.get('oai-authenticated-user-id'),email=(request.headers.get('oai-authenticated-user-email')||'').toLowerCase();
 const canUpload=!!id&&!!email&&!!env.M1_UPLOADER_EMAIL&&email===env.M1_UPLOADER_EMAIL.trim().toLowerCase();
 if(url.pathname.startsWith('/api/forma/')){try{return await formaRoutes(request,env,canUpload,stored,validateSnapshot);}catch{return json({error:'The Autodesk connection could not be read. The saved report is unchanged.'},503);}}
 if(url.pathname==='/api/session')return json({canUpload,viewAccess:'public'});
 if(url.pathname==='/api/team')return canUpload?json({error:'Viewing is now public. Share the dashboard link; viewer invitations are no longer needed.'},410):json({error:'Owner access required.'},403);
 if(url.pathname==='/api/snapshot'){
  if(!env.BUCKET)return json({error:'Shared storage is unavailable. No report has been changed.'},503);
  try{
   if(request.method==='GET'){const {data}=await stored(env),tag='"'+data.revision+'"';if(request.headers.get('If-None-Match')===tag)return new Response(null,{status:304,headers:{ETag:tag,'Cache-Control':'no-store'}});return json(data,200,{ETag:tag});}
   if(request.method!=='PUT')return json({error:'Method not allowed.'},405);
   if(!canUpload)return json({error:'Only the dashboard owner can publish a new log.'},403);
   if(request.headers.get('Origin')!==url.origin)return json({error:'Invalid request origin.'},403);
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Expected a validated JSON snapshot.'},415);
   const max=12*1024*1024;if(Number(request.headers.get('Content-Length')||0)>max)return json({error:'Report is too large.'},413);
   const reader=request.body?.getReader();if(!reader)return json({error:'Empty report.'},400);let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();return json({error:'Report is too large.'},413);}chunks.push(value);}const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
   const input=JSON.parse(new TextDecoder().decode(bytes)),next=validateSnapshot(input.snapshot),old=await stored(env);
   if(input.expectedRevision!==old.data.revision)return json({error:'A newer update was published. Refresh and load your log again.'},409);
   if(next.reportAt<old.data.current.reportAt)return json({error:'This report is older than the shared snapshot.'},409);
   const same=JSON.stringify(next.reviews)===JSON.stringify(old.data.current.reviews)&&next.voidCount===old.data.current.voidCount;
   const value={revision:old.data.revision+1,current:{...next,loadedAt:Date.now()},previous:same?old.data.previous:old.data.current,updatedAt:Date.now()};
   const condition=old.etag?{etagMatches:old.etag}:new Headers({'If-None-Match':'*'});
   const saved=await env.BUCKET.put(KEY,JSON.stringify(value),{onlyIf:condition,httpMetadata:{contentType:'application/json'}});
   if(!saved)return json({error:'Another update was saved first. Refresh and retry.'},409);
   return json(value,200,{ETag:'"'+value.revision+'"'});
  }catch(e){if(e instanceof SyntaxError)return json({error:'The uploaded snapshot is not valid JSON.'},400);if(/Invalid|Duplicate|Void/.test(e.message))return json({error:e.message},400);return json({error:'The shared report could not be saved or read. Please retry.'},500);}
 }
 if(url.pathname!=='/'&&url.pathname!=='/index.html')return new Response('Not found',{status:404});
 return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
}};
