import {accessToken,getAPS} from './forma.mjs';
import {sources} from './sources.mjs';
import {folderPath,nextPath} from './models.mjs';
const key='m1/formats/state';
const roots={progress1:sources.progress1,progress2:sources.progress2,review:'urn:adsk.wipemea:fs.folder:co.kWJCSblxQaaYrIWQVDZeow'};
function init(sql){sql.exec('CREATE TABLE IF NOT EXISTS format_queue (generation TEXT,source TEXT,path TEXT,task TEXT,done INTEGER DEFAULT 0,PRIMARY KEY(generation,source,path))');sql.exec('CREATE TABLE IF NOT EXISTS format_files (generation TEXT,source TEXT,id TEXT,body TEXT,PRIMARY KEY(generation,source,id))');}
export async function formatState(env){return await (await env.BUCKET.get(key))?.json()||{};}
export async function formatStatus(env){const s=await formatState(env);init(env.SQL);return {...s,queue:env.SQL.exec('SELECT COUNT(*) total,SUM(done) checked FROM format_queue WHERE generation=?',s.generation||'').toArray()[0]};}
export async function formatSnapshot(env){const s=await formatState(env);if(!s.published)return null;init(env.SQL);return {checkedAt:s.checkedAt,files:env.SQL.exec('SELECT body FROM format_files WHERE generation=?',s.published).toArray().map(r=>JSON.parse(r.body))};}
export async function syncFormats(env,read=getAPS,tokenProvider=accessToken){
 const sql=env.SQL;init(sql);let s=await formatState(env),now=Date.now();if(s.nextBatch>now||s.leaseUntil>now)return {updating:!!s.active};
 if(!s.active&&s.nextAt>now)return {skipped:true};
 s.leaseUntil=now+120000;await env.BUCKET.put(key,JSON.stringify(s));
 try{
  if(!s.active){const generation=crypto.randomUUID();s={...s,generation,active:true,startedAt:now,error:null};sql.exec('DELETE FROM format_queue WHERE generation<>?',s.published||'');sql.exec('DELETE FROM format_files WHERE generation<>?',s.published||'');for(const [source,id] of Object.entries(roots)){const task={source,folderId:id,path:folderPath('b.'+env.ACC_PROJECT_ID.replace(/^b\./,''),id),trail:[]};sql.exec('INSERT INTO format_queue(generation,source,path,task) VALUES(?,?,?,?)',generation,source,task.path,JSON.stringify(task));}}
  if(now-s.startedAt>12*3600000)throw Error('Format check expired.');
  const token=await tokenProvider(env);
  for(let n=0;n<18;n+=3){
   const batch=sql.exec('SELECT source,path,task FROM format_queue WHERE generation=? AND done=0 LIMIT 3',s.generation).toArray();if(!batch.length)break;
   const results=await Promise.allSettled(batch.map(async row=>{const task=JSON.parse(row.task);return {task,page:await read(task.path,token)};}));let failure=null;
   for(const result of results){if(result.status==='rejected'){failure||=result.reason;continue;}const {task,page}=result.value;if(!Array.isArray(page.data))throw Error('Incomplete folder response.');
   for(const item of page.data){const name=item.attributes?.displayName||item.attributes?.name;if(!item.id||!name)throw Error('Incomplete file metadata.');
    if(item.type==='folders'){const child={source:task.source,folderId:item.id,path:folderPath('b.'+env.ACC_PROJECT_ID.replace(/^b\./,''),item.id),trail:[...task.trail,name]};sql.exec('INSERT OR IGNORE INTO format_queue(generation,source,path,task) VALUES(?,?,?,?)',s.generation,task.source,child.path,JSON.stringify(child));}
    else if(item.type==='items'&&/\.(rvt|dwg|ifc|nwc|nwd|dwfx)$/i.test(name)){const version=page.included?.find(v=>v.type==='versions'&&v.id===item.relationships?.tip?.data?.id);const f={id:item.id,name,source:task.source,folderId:task.folderId,folderPath:task.trail,updatedAt:version?.attributes?.lastModifiedTime||item.attributes?.lastModifiedTime||null,version:version?.attributes?.versionNumber||null};sql.exec('INSERT INTO format_files(generation,source,id,body) VALUES(?,?,?,?) ON CONFLICT(generation,source,id) DO UPDATE SET body=excluded.body',s.generation,task.source,item.id,JSON.stringify(f));}
   }
   const next=nextPath(page.links?.next,task.path);if(next){if(sql.exec('SELECT 1 FROM format_queue WHERE generation=? AND source=? AND path=?',s.generation,task.source,next).toArray().length)throw Error('Repeated folder page.');sql.exec('INSERT INTO format_queue(generation,source,path,task) VALUES(?,?,?,?)',s.generation,task.source,next,JSON.stringify({...task,path:next}));}
   sql.exec('UPDATE format_queue SET done=1 WHERE generation=? AND source=? AND path=?',s.generation,task.source,task.path);
   }if(failure)throw failure;
  }
  if(!sql.exec('SELECT 1 FROM format_queue WHERE generation=? AND done=0 LIMIT 1',s.generation).toArray().length){s.published=s.generation;s.checkedAt=Date.now();s.active=false;s.nextAt=Date.now()+900000;}
  s.nextBatch=Date.now()+10000;s.error=null;return {updating:s.active};
 }catch(e){s.error=e.message;s.nextBatch=Math.max(Date.now()+300000,e.retryAt||0);if(now-s.startedAt>12*3600000){s.active=false;s.nextAt=s.nextBatch;}throw e;}
 finally{s.leaseUntil=0;await env.BUCKET.put(key,JSON.stringify(s));}
}
