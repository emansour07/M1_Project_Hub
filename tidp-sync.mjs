import {accessToken,getAPS} from './forma.mjs';
import {downloadItemWorkbook} from './sources.mjs';
import {getScope} from './scope.mjs';
import {TIDP_FOLDER,sourceScope,extractTidp,mergeTidps,exportTidps} from './tidp-merge.mjs';
import {filterDeliverables} from './delivery-core.mjs';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
const PREFIX='m1/tidps/',VERSION=1;
const read=async(env,key)=>await(await env.BUCKET.get(PREFIX+key))?.json()||null;
const put=(env,key,value)=>env.BUCKET.put(PREFIX+key,JSON.stringify(value));
const pack=value=>{const b=zipSync({record:strToU8(JSON.stringify(value))},{level:1});let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return {compressed:btoa(s)};};
const recordRead=async(env,key)=>{const saved=await read(env,key);return saved?.compressed?JSON.parse(strFromU8(unzipSync(Uint8Array.from(atob(saved.compressed),c=>c.charCodeAt(0))).record)):saved;};
export async function listTidps(env,policy){
 const token=await accessToken(env),project='b.'+env.ACC_PROJECT_ID.replace(/^b\./,'');let path='/data/v1/projects/'+encodeURIComponent(project)+'/folders/'+encodeURIComponent(TIDP_FOLDER)+'/contents',files=[],seen=new Set();
 while(path){if(seen.has(path)||seen.size>=10)throw Error('TIDP folder pagination limit exceeded.');seen.add(path);const page=await getAPS(path,token);for(const item of page.data||[]){const name=item.attributes?.displayName||item.attributes?.name||'';if(item.type==='items'&&/_TIDP_.+\.xlsx$/i.test(name)&&!name.startsWith('~$')&&sourceScope(name,policy))files.push({id:item.id,name,versionId:item.relationships?.tip?.data?.id});}const next=page.links?.next?.href||page.links?.next;if(next){const u=new URL(next,'https://developer.api.autodesk.com');if(u.origin!=='https://developer.api.autodesk.com'||!u.pathname.startsWith('/data/v1/projects/'+encodeURIComponent(project)+'/folders/'))throw Error('Unexpected TIDP pagination link.');path=u.pathname+u.search;}else path=null;}
 if(!files.length)throw Error('No scoped TIDPs found in the main TIDP folder.');if(files.length>100)throw Error('TIDP folder exceeds 100 workbooks.');return files.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function tidpStatus(env){const s=await read(env,'state');return s?{active:!!s.active,done:s.index||0,total:s.list?.length||0,failed:!!s.failed,checkedAt:s.checkedAt||null}:null;}
export async function tidpSnapshot(env){const meta=await read(env,'latest');if(!meta)return null;const entries=[];for(let i=0;i<meta.chunks;i++){const chunk=await read(env,meta.generation+'/entries/'+i);if(!chunk)throw Error('Merged TIDP register is incomplete.');entries.push(...chunk);}return {...meta,entries,checking:await tidpStatus(env)};}
export async function syncTidpBatch(env,force=false,services={}){
 const policy=await getScope(env);if(!policy)throw Error('Scope is not ready.');let state=await read(env,'state');const now=Date.now();if(state?.leaseUntil>now)return {updating:true};if(!state?.active&&!force&&state?.checkedAt>now-900000)return {updating:false};
 if(!state?.active||state.scopeVersion!==policy.revision){state={active:true,index:0,generation:crypto.randomUUID(),scopeVersion:policy.revision,leaseUntil:now+120000};await put(env,'state',state);try{state.list=await(services.list||listTidps)(env,policy);}catch(e){state.active=false;state.failed=true;state.leaseUntil=0;await put(env,'state',state);throw e;}}
 state.leaseUntil=now+120000;state.failed=false;await put(env,'state',state);
 try{
  const prior=await read(env,'latest'),batchStarted=Date.now();let downloads=0;
  for(let batch=0;batch<100&&state.index<state.list.length;batch++){const item=state.list[state.index],key=state.generation+'/record/'+state.index;
   const cachedIndex=prior?.scopeVersion===policy.revision?prior.source.sources.findIndex(s=>s.itemId===item.id&&s.versionId===item.versionId):-1;
   if(cachedIndex>=0){const cached=await read(env,prior.generation+'/record/'+cachedIndex);if(!cached)throw Error('TIDP cache is incomplete.');await put(env,key,cached);state.index++;}
   else{if(downloads>=(services.batchSize||3))break;const data=await(services.download||downloadItemWorkbook)(env,item.id);const record=extractTidp(data.bytes,data.source,policy);await put(env,key,pack(record));state.index++;downloads++;}
   await put(env,'state',state);if(Date.now()-batchStarted>5000)break;
  }
  if(state.index===state.list.length){
   // Confirm every source still has the version read. Do not publish a mixed refresh if a TIDP changed mid-scan.
   const current=await(services.list||listTidps)(env,policy),records=[];for(let i=0;i<state.list.length;i++){const r=await recordRead(env,state.generation+'/record/'+i);records.push(r?{source:r.source,entries:r.entries}:r);}
   const versions=new Map(current.map(x=>[x.id,x.versionId]));if(current.length!==state.list.length||records.some(r=>!r||!versions.has(r.source.itemId)||(versions.get(r.source.itemId)&&versions.get(r.source.itemId)!==r.source.versionId))){state.active=false;state.checkedAt=0;throw Error('TIDPs changed during the merge. A fresh scan will run.');}
   const merged=mergeTidps(records);if(!merged.total)throw Error('No scoped TIDP deliverables were found.');const checkedAt=Date.now(),source={kind:'tidp-merge',name:'MIDP from current TIDPs',version:state.generation,checkedAt,updatedAt:records.map(r=>r.source.updatedAt||'').sort().at(-1),sources:records.map(r=>r.source)},chunks=Math.ceil(merged.total/500);
   for(let i=0;i<chunks;i++)await put(env,state.generation+'/entries/'+i,merged.entries.slice(i*500,(i+1)*500));
   const found=new Set(records.map(r=>sourceScope(r.source.name,policy)?.id)),missingSources=policy.rows.filter(r=>!found.has(r.id)).map(r=>({id:r.id,name:r.name,code:r.code}));
   const meta={source,generation:state.generation,scopeVersion:policy.revision,chunks,recordCount:records.length,total:merged.total,dated:merged.entries.filter(r=>r.plannedDate).length,duplicates:merged.duplicates,conflicts:merged.conflicts,missingSources,parserVersion:VERSION};
   await put(env,'latest',meta);await env.BUCKET.put('m1/workbooks/midp',JSON.stringify({source,rows:merged.entries.filter(r=>r.category==='Models'&&!/YYY.*BIM/i.test(r.sheet))}));
   state.active=false;state.checkedAt=checkedAt;
   if(env.SQL)env.SQL.exec("DELETE FROM objects WHERE key LIKE 'm1/tidps/%' AND key NOT IN ('m1/tidps/latest','m1/tidps/state') AND key NOT LIKE ? AND key NOT LIKE ?",PREFIX+state.generation+'/%',PREFIX+(prior?.generation||state.generation)+'/%');
  }
  state.leaseUntil=0;await put(env,'state',state);return {updating:state.active,done:state.index,total:state.list.length};
 }catch(e){state.failed=true;state.leaseUntil=0;await put(env,'state',state);throw e;}
}
export async function exportMergedTidps(env,start,end,filters={}){
 const saved=await tidpSnapshot(env);if(!saved)throw Error('The TIDPs are being read. Export will be available after the first complete merge.');
 const rows=filterDeliverables(saved.entries,filters),records=[];
 for(let i=0;i<saved.recordCount;i++){const record=await recordRead(env,saved.generation+'/record/'+i);if(!record)throw Error('The TIDP export source is incomplete.');records.push(record);}
 return {...exportTidps(records,rows,start,end),source:saved.source};
}
