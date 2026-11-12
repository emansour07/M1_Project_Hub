import {accessToken,getAPS} from './forma.mjs';
export const sources={
 reference:'urn:adsk.wipemea:fs.folder:co.6tClIOPzQGyEeWnblrUTng',
 progress1:'urn:adsk.wipemea:fs.folder:co.VehAR6QsSlSwFkACDHnCtQ',
 progress2:'urn:adsk.wipemea:fs.folder:co.6wa3eF4wR-eI0UzMqkyB7g',
 trackerFolder:'urn:adsk.wipemea:fs.folder:co.kzFcCskdT0STsx3N2xYM8A',
 tracker:'urn:adsk.wipemea:dm.lineage:8Uhmx_-pRTGvI__MKFA_-A',
 midp:'urn:adsk.wipemea:dm.lineage:Kx4epOWERrSmEs2pLoS5SA',
 tidpFolder:'urn:adsk.wipemea:fs.folder:co.3hNWncQDQZqVV9YPTm7Pyg',
 tidp:'urn:adsk.wipemea:dm.lineage:ByB-0ya4S7C6oJlJIkCo9A'
};
export async function checkSourceAccess(env){
 const token=await accessToken(env),p=encodeURIComponent('b.'+env.ACC_PROJECT_ID.replace(/^b\./,'')),result=[];
 for(const key of ['reference','progress1','progress2','trackerFolder']){
  try{const data=await getAPS(`/data/v1/projects/${p}/folders/${encodeURIComponent(sources[key])}/contents`,token);result.push({source:key,ok:true,items:(data.data||[]).map(x=>({id:x.id,type:x.type,name:x.attributes?.displayName||x.attributes?.name}))});}
  catch(e){result.push({source:key,ok:false,status:e.status||null,detail:e.providerError||null});}
 }
 try{const data=await getAPS('/construction/reviews/v1/projects/'+env.ACC_PROJECT_ID.replace(/^b\./,'')+'/reviews?limit=1',token);result.push({source:'reviews',ok:true,total:data.pagination?.totalResults??null});}catch(e){result.push({source:'reviews',ok:false,status:e.status||null,detail:e.providerError||null});}
 return {sources:result};
}
export async function downloadWorkbook(env,key){
 if(!['tracker','midp','tidp'].includes(key))throw Error('Unknown source.');
 const token=await accessToken(env),p=encodeURIComponent('b.'+env.ACC_PROJECT_ID.replace(/^b\./,''));
 const tip=await getAPS(`/data/v1/projects/${p}/items/${encodeURIComponent(sources[key])}/tip`,token);
 const v=tip.data,urn=v?.relationships?.storage?.data?.id;
 const match=/^urn:adsk.objects:os.object:([^/]+)\/(.+)$/.exec(urn||'');
 if(!match)throw Error('Workbook storage is unavailable.');
 if(v.attributes?.storageSize>10000000)throw Error('Workbook exceeds the 10 MB limit.');
 const signed=await getAPS(`/oss/v2/buckets/${encodeURIComponent(match[1])}/objects/${encodeURIComponent(match[2])}/signeds3download`,token);
 const url=new URL(signed.url);
 if(url.protocol!=='https:'||!/(^|\.)amazonaws\.com$/.test(url.hostname))throw Error('Unexpected download host.');
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Workbook download failed.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>10000000){await reader.cancel();throw Error('Workbook exceeds the 10 MB limit.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return {bytes,source:{itemId:sources[key],name:v.attributes?.displayName||v.attributes?.name||key,version:v.attributes?.versionNumber,updatedAt:v.attributes?.lastModifiedTime,checkedAt:Date.now()}};
}
