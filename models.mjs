import {accessToken,getAPS} from './forma.mjs';
const ROOT='m1/models/',PERIOD=300000;
async function read(env,key){const v=await env.BUCKET.get(ROOT+key);return v?{value:await v.json(),etag:v.etag}:null;}
async function write(env,key,value,etag){return env.BUCKET.put(ROOT+key,JSON.stringify(value),etag?{onlyIf:{etagMatches:etag}}:{});}
export const emptyBaseline=()=>({assets:[],disciplines:[],requirements:[]});
export async function modelSnapshot(env){return {baseline:(await read(env,'baseline'))?.value||emptyBaseline(),scan:(await read(env,'snapshot'))?.value||null};}
export async function saveBaseline(env,baseline){await write(env,'baseline',baseline);}
export function folderPath(project,folder){return '/data/v1/projects/'+encodeURIComponent(project)+'/folders/'+encodeURIComponent(folder)+'/contents';}
export function nextPath(link,current){if(!link)return null;const href=typeof link==='string'?link:link.href;if(typeof href!=='string')throw Error('Invalid pagination link.');const url=new URL(href,'https://developer.api.autodesk.com');if(url.origin!=='https://developer.api.autodesk.com'||url.pathname!==current.split('?')[0])throw Error('Unexpected pagination target.');return url.pathname+url.search;}
export function applyFolderPage(job,page,task){
 if(!Array.isArray(page.data))throw Error('Invalid folder contents.');
 for(const item of page.data){if(!item.id||!item.type)throw Error('Incomplete folder contents.');if(item.type==='folders'){
   if(!job.folders.includes(item.id)){job.folders.push(item.id);job.queue.push({folderId:item.id,path:folderPath(job.project,item.id)});}
  }else if(item.type==='items'){
   if(job.itemIds.includes(item.id))throw Error('Folder contents changed during checking.');job.itemIds.push(item.id);
   const name=item.attributes?.displayName||item.attributes?.name;if(!name)throw Error('A file is missing its name.');
   if(/\.(rvt|ifc|nwc|nwd)$/i.test(name)){
    const tip=item.relationships?.tip?.data?.id,version=page.included?.find(v=>v.type==='versions'&&v.id===tip);
    job.files.push({id:item.id,name,folderId:task.folderId,version:version?.attributes?.versionNumber||'',updatedAt:item.attributes?.lastModifiedTime||null});
   }
  }
 }
 const next=nextPath(page.links?.next,task.path);if(next){if(job.pages.includes(next))throw Error('Repeated folder page.');job.queue.unshift({folderId:task.folderId,path:next});}
 if(job.itemIds.length>15000||job.folders.length>3000)throw Error('Folder scope is too large. Narrow the original-design folder.');
}
export async function syncModels(env,manual=false,readApi=getAPS){
 if(!env.ACC_PROJECT_ID||!env.ACC_DESIGN_FOLDER_ID)return {available:false};
 const oldLease=await read(env,'lease');if(oldLease?.value.until>Date.now())return {updating:true};
 const lease=await env.BUCKET.put(ROOT+'lease',JSON.stringify({until:Date.now()+120000}),{onlyIf:oldLease?{etagMatches:oldLease.etag}:new Headers({'If-None-Match':'*'})});if(!lease)return {updating:true};
 try{
  const project='b.'+env.ACC_PROJECT_ID.replace(/^b\./,''),root=env.ACC_DESIGN_FOLDER_ID;let job=(await read(env,'job'))?.value;const status=(await read(env,'status'))?.value||{};
  if(!job?.active){if(status.nextAttemptAt>Date.now()&&(!manual||status.lastAttemptAt+60000>Date.now()))return {skipped:true};job={active:true,project,root,startedAt:Date.now(),queue:[{folderId:root,path:folderPath(project,root)}],folders:[root],itemIds:[],pages:[],files:[]};}
  if(job.project!==project||job.root!==root||Date.now()-job.startedAt>3600000)throw Error('Folder check needs to restart.');
  const token=await accessToken(env);let calls=0;
  while(job.queue.length&&calls<20){const task=job.queue.shift();if(job.pages.includes(task.path))throw Error('Repeated folder page.');const page=await readApi(task.path,token);calls++;job.pages.push(task.path);applyFolderPage(job,page,task);}
  if(job.queue.length){await write(env,'job',job);return {updating:true};}
  const now=Date.now();await write(env,'snapshot',{complete:true,checkedAt:now,startedAt:job.startedAt,project,folderId:root,files:job.files});await write(env,'job',{active:false});await write(env,'status',{lastAttemptAt:now,nextAttemptAt:now+PERIOD,error:null});return {ok:true,lastSuccessAt:now};
 }catch(e){await write(env,'job',{active:false});await write(env,'status',{lastAttemptAt:Date.now(),nextAttemptAt:Date.now()+PERIOD,error:e.message});throw e;}finally{await write(env,'lease',{until:0},lease.etag);}
}
