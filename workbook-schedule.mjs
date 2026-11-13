import {workbookSnapshot,syncWorkbook} from './workbooks.mjs';

export async function syncNextWorkbook(env,read=workbookSnapshot,sync=syncWorkbook){
 const keys=['scope','tidp','tracker','midp'];
 const last=await(await env.BUCKET.get('m1/workbooks/last-attempt'))?.json();
 const start=(keys.indexOf(last)+1)%keys.length;
 for(let i=0;i<keys.length;i++){
  const key=keys[(start+i)%keys.length],saved=await read(env,key);
  if(!saved||Date.now()-saved.source.checkedAt>900000){
   await env.BUCKET.put('m1/workbooks/last-attempt',JSON.stringify(key));
   return sync(env,key);
  }
 }
 return {skipped:true};
}
