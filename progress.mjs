import {accessToken,getAPS} from './forma.mjs';
import {sources} from './sources.mjs';
import {folderPath,nextPath} from './models.mjs';
import {buildProgress} from './progress-core.mjs';
import {workbookSnapshot} from './workbooks.mjs';
const key='m1/progress/state';
function init(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS progress_queue (generation TEXT, source TEXT, path TEXT, task TEXT, done INTEGER DEFAULT 0, PRIMARY KEY(generation,source,path))');
 sql.exec('CREATE TABLE IF NOT EXISTS progress_files (generation TEXT, source TEXT, id TEXT, body TEXT, PRIMARY KEY(generation,source,id))');
}
async function state(env){const s=await env.BUCKET.get(key);return s?await s.json():{};}
async function save(env,s){await env.BUCKET.put(key,JSON.stringify(s));}
export function excludedReferenceFolder(name){return /^(?:\d+[._\s-]*)?other[ _-]*assets$/i.test(String(name).trim());}
export async function progressSnapshot(env){
 const s=await state(env);if(!s.published)return {scan:null,checking:{active:!!s.active,failed:!!s.error}};
 init(env.SQL);const files=env.SQL.exec('SELECT body FROM progress_files WHERE generation=?',s.published).toArray().map(r=>JSON.parse(r.body));
 const mapping=await workbookSnapshot(env,'tidp'),tracker=await workbookSnapshot(env,'tracker');
 return {scan:buildProgress(files,mapping?.rows||[],tracker?.rows||[],s.checkedAt),mappingSource:mapping?.source||null,trackerSource:tracker?.source||null,checking:{active:!!s.active,failed:!!s.error}};
}
export async function syncProgress(env,manual=false,readApi=getAPS,getToken=accessToken){
 const sql=env.SQL;init(sql);let s=await state(env),activeTask=null;const now=Date.now();if(s.leaseUntil>now)return {updating:true};
 if(!s.active&&s.nextAt>now&&(!manual||s.lastAttempt+60000>now))return {skipped:true};
 s.leaseUntil=now+120000;await save(env,s);
 try{
  const project='b.'+env.ACC_PROJECT_ID.replace(/^b\./,'');
  if(!await workbookSnapshot(env,'tidp')||!await workbookSnapshot(env,'tracker'))throw Error('The asset mapping and progress tracker must be read first.');
  if(!s.active&&s.retryGeneration&&s.generation&&now-s.startedAt<12*3600000){s.active=true;s.error=null;s.retryGeneration=false;s.lastAttempt=now;await save(env,s);}
  if(!s.active){
   const generation=crypto.randomUUID();s={...s,generation,active:true,startedAt:now,lastAttempt:now,pages:0,error:null};
   sql.exec('DELETE FROM progress_queue WHERE generation<>?',s.published||'');sql.exec('DELETE FROM progress_files WHERE generation<>?',s.published||'');
   for(const source of ['reference','progress1','progress2']){const task={source,folderId:sources[source],path:folderPath(project,sources[source]),trail:[]};sql.exec('INSERT INTO progress_queue(generation,source,path,task) VALUES(?,?,?,?)',generation,source,task.path,JSON.stringify(task));}
   await save(env,s);
  }
  if(now-s.startedAt>12*3600000)throw Error('Folder check expired.');
  const token=await getToken(env);let count=0;
  while(count<18){
   const row=sql.exec('SELECT path,source,task FROM progress_queue WHERE generation=? AND done=0 LIMIT 1',s.generation).toArray()[0];if(!row)break;
   const task=JSON.parse(row.task);activeTask=task;const page=await readApi(task.path,token);count++;
   if(!Array.isArray(page.data))throw Error('Incomplete folder contents.');
   if(task.source==='reference'&&task.folderId===sources.reference&&!page.links?.next){
    const names=new Set(page.data.filter(x=>x.type==='folders').map(x=>String(x.attributes?.displayName||x.attributes?.name).toLowerCase()));
    if(!['island','mainland','subsea'].every(n=>names.has(n)))throw Error('Reference folder access is incomplete.');
   }
   for(const item of page.data){
    const name=item.attributes?.displayName||item.attributes?.name||'';if(!item.id||!name)throw Error('Incomplete file metadata.');
    if(item.type==='folders'){
     if(task.source==='reference'&&excludedReferenceFolder(name))continue;
     const next={source:task.source,folderId:item.id,path:folderPath(project,item.id),trail:[...task.trail,name]};
     sql.exec('INSERT OR IGNORE INTO progress_queue(generation,source,path,task) VALUES(?,?,?,?)',s.generation,task.source,next.path,JSON.stringify(next));
    }else if(item.type==='items'&&(task.source==='reference'?/\.(pdf|dwg|dgn|dxf|rvt|ifc|nwc|nwd)$/i:/\.(rvt|dwg)$/i).test(name)){
     const version=page.included?.find(v=>v.type==='versions'&&v.id===item.relationships?.tip?.data?.id);
     const f={id:item.id,name,source:task.source,folderId:task.folderId,folderPath:task.trail,version:version?.attributes?.versionNumber||null,updatedAt:version?.attributes?.lastModifiedTime||item.attributes?.lastModifiedTime||null};
     sql.exec('INSERT INTO progress_files(generation,source,id,body) VALUES(?,?,?,?) ON CONFLICT(generation,source,id) DO UPDATE SET body=excluded.body',s.generation,task.source,item.id,JSON.stringify(f));
    }
   }
   const next=nextPath(page.links?.next,task.path);
   if(next){const exists=sql.exec('SELECT done FROM progress_queue WHERE generation=? AND source=? AND path=?',s.generation,task.source,next).toArray()[0];if(exists)throw Error('Repeated folder page.');sql.exec('INSERT INTO progress_queue(generation,source,path,task) VALUES(?,?,?,?)',s.generation,task.source,next,JSON.stringify({...task,path:next}));}
   sql.exec('UPDATE progress_queue SET done=1 WHERE generation=? AND source=? AND path=?',s.generation,task.source,task.path);s.pages++;
  }
  if(!sql.exec('SELECT 1 FROM progress_queue WHERE generation=? AND done=0 LIMIT 1',s.generation).toArray().length){s.published=s.generation;s.checkedAt=Date.now();s.active=false;s.nextAt=Date.now()+300000;}
  return {updating:s.active,ok:!s.active};
 }catch(e){s.active=false;s.error=e.message;s.retryGeneration=!!s.generation&&Date.now()-s.startedAt<12*3600000;s.lastAttempt=Date.now();s.lastFailure={at:Date.now(),message:e.message,status:e.status||null,detail:e.providerError||null,task:activeTask};s.nextAt=Date.now()+300000;throw e;}
 finally{s.leaseUntil=0;await save(env,s);}
}
