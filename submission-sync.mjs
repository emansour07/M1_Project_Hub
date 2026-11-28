// Scheduled pull of the ARX–SAPAC and SAPAC–MACE logs from the ACC Submission_Logs folder.
// A log is published only when it reads cleanly and matches the MIDP; otherwise the published log stays as it is.
import {accessToken,getAPS} from './forma.mjs';
import {sources,downloadItemWorkbook} from './sources.mjs';
import {workbookTables} from './assurance.mjs';
import {getScope} from './scope.mjs';
import {midpSnapshot} from './workbooks.mjs';
import {SubmissionStore} from './submissions.mjs';
import {STAGES} from './submissions-core.mjs';
import {pickLogFiles,logFromSheets,LOG_FILE_NAMES} from './submission-sync-core.mjs';
const KEY='m1/submission-logs/state',INTERVAL=6*3600000,LEASE=120000;
const read=async env=>await(await env.BUCKET.get(KEY))?.json()||{};
const write=(env,state)=>env.BUCKET.put(KEY,JSON.stringify(state));
const dubaiDay=value=>{const t=Date.parse(value||'');return Number.isFinite(t)?new Date(t+4*3600000).toISOString().slice(0,10):'';};
export async function listLogFiles(env){
 const token=await accessToken(env),project='b.'+env.ACC_PROJECT_ID.replace(/^b\./,''),base='/data/v1/projects/'+encodeURIComponent(project)+'/folders/';let path=base+encodeURIComponent(sources.submissionLogs)+'/contents';const files=[],seen=new Set();
 while(path){if(seen.has(path)||seen.size>=5)throw Error('Submission log folder pagination limit exceeded.');seen.add(path);const page=await getAPS(path,token);
  for(const item of page.data||[]){const name=item.attributes?.displayName||item.attributes?.name||'';if(item.type==='items'&&/\.xlsx$/i.test(name))files.push({id:item.id,name,versionId:item.relationships?.tip?.data?.id||null});}
  const next=page.links?.next?.href||page.links?.next;if(next){const u=new URL(next,'https://developer.api.autodesk.com');if(u.origin!=='https://developer.api.autodesk.com'||!u.pathname.startsWith(base))throw Error('Unexpected submission log pagination link.');path=u.pathname+u.search;}else path=null;}
 return files;
}
// What the dashboard may show: per log, the ACC file read, when, and why a newer file was not published.
export async function submissionSyncStatus(env){const s=await read(env);return {checkedAt:s.checkedAt||null,error:s.error||null,logs:Object.keys(STAGES).map(stage=>({stage,file:LOG_FILE_NAMES[stage],...(s.logs?.[stage]||{state:'waiting'})}))};}
export async function syncSubmissionLogs(env,force=false,services={}){
 const now=Date.now();let state=await read(env);
 if(state.leaseUntil>now)return {updating:true};
 if(!force&&state.checkedAt>now-INTERVAL)return {updating:false,skipped:true};
 state={...state,leaseUntil:now+LEASE,logs:state.logs||{}};await write(env,state);
 try{
  const entries=services.entries||(await midpSnapshot(env))?.entries||[],scope=services.scope||(await getScope(env))?.rows||[];
  if(!entries.length)throw Error('The MIDP is not loaded yet.');
  const store=services.store||new SubmissionStore(env.SQL),picked=pickLogFiles(await(services.list||listLogFiles)(env));
  for(const stage of Object.keys(STAGES)){
   const previous=state.logs[stage]||{},{file,error}=picked[stage];
   if(!file){state.logs[stage]={...previous,state:'missing',error,checkedAt:now};continue;}
   // The same ACC version is read once. A version that failed is tried again, in case the MIDP has caught up.
   if(previous.versionId&&previous.versionId===file.versionId&&previous.state==='published'){state.logs[stage]={...previous,checkedAt:now};continue;}
   try{
    const data=await(services.download||downloadItemWorkbook)(env,file.id),parsed=workbookTables(data.bytes,{strict:true});
    if(parsed.sheets.some(s=>s.rows.length>=10050))throw Error('The worksheet exceeds 10,000 entries.');
    const current=store.list().find(r=>r.stage===stage),log=logFromSheets(parsed.sheets,{stage,source:data.source.name||file.name,asOf:dubaiDay(data.source.updatedAt),mappings:current?.mappings||[]});
    const {table,...payload}=log,report=store.save({...payload,baseRevision:current?.revision||0},entries,scope);
    state.logs[stage]={state:'published',error:null,itemId:file.id,versionId:data.source.versionId||file.versionId,version:data.source.version??null,name:data.source.name||file.name,fileUpdatedAt:data.source.updatedAt||null,asOf:report.asOf,rows:report.rows.length,sheet:table.sheet,headerRow:table.headerRow,dateOrder:table.dateOrder,publishedAt:now,checkedAt:now};
   }catch(e){
    console.error('Submission log not published',stage,e.message);
    state.logs[stage]={...previous,state:previous.asOf?'kept':'failed',error:e.message,failedVersionId:file.versionId,checkedAt:now};
   }
  }
  state.checkedAt=now;state.error=null;
 }catch(e){console.error('Submission log check failed',e.message);state.checkedAt=now-INTERVAL+900000;state.error='The ACC submission log folder could not be checked.';}
 state.leaseUntil=0;await write(env,state);return {updating:false,...await submissionSyncStatus(env)};
}
