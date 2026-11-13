import {getScope,scopedFile,scopeMatch} from './scope.mjs';
import {compareReceived,receivedKey,RECEIVED_FORMATS} from './received-core.mjs';
const read=async(env,key)=>await(await env.BUCKET.get(key))?.json();
export function receivedAsset(row,policy){
 const p=row.name.split('-'),parcel=p[1],numeric=/^\d{3}$/.test(parcel);
 if(numeric&&!['102','121'].includes(parcel))return null;
 const context=row.source.replace('MIDP M1 - ','');
 const hint=!numeric?/(?:^|\W)(102|121)(?:-|\W)/.exec(context)?.[1]:null;
 const asset=scopeMatch({name:row.name,description:row.description,folderPath:[context],parcel:hint},policy);
 return asset&&policy?.rows.some(a=>a.id===asset.id)?asset:null;
}
export function validateReceived(input,policy){
 if(!input||!Array.isArray(input.rows)||input.rows.length>5000||!Number.isFinite(input.sourceCheckedAt))throw Error('Select a prepared model-receipt analysis.');
 const ids=new Set(),rows=[];
 for(const r of input.rows){if(!r||['id','name','description','source','discipline','revision'].some(k=>typeof r[k]!=='string'||r[k].length>1000)||!receivedKey(r.name,r.scopeId)||ids.has(r.id))throw Error('Invalid or repeated model entry.');ids.add(r.id);
  let a=receivedAsset(r,policy);const pending=!a&&input.scopeReviewed===true&&r.assetAssignmentPending===true&&r.scopeId==='pending';if(pending)a={id:'pending',code:'Unassigned',name:'Asset assignment pending',zone:'Area to confirm'};if(!a||a.id!==r.scopeId)continue;
  rows.push({id:r.id,name:r.name,description:r.description,source:r.source,discipline:r.discipline,revision:r.revision,scopeId:a.id,asset:a.proposed||a.code,assetName:a.name,zone:a.zone,assetAssignmentPending:pending,formats:Object.fromEntries(RECEIVED_FORMATS.map(f=>[f,{sourceAvailable:r.formats?.[f]?.sourceAvailable===true,workbookReceived:r.formats?.[f]?.workbookReceived===true}]))});
 }
 if(!rows.length)throw Error('No confirmed scoped models were found.');
 return {sourceName:'M1_Models_Received.xlsx',sourceCheckedAt:input.sourceCheckedAt,importedAt:Date.now(),rows};
}
export async function receivedSnapshot(env){
 const [data,policy,state]=await Promise.all([read(env,'m1/received'),getScope(env),read(env,'m1/progress/state')]);
 const rows=(data?.rows||[]).filter(r=>r.assetAssignmentPending||receivedAsset(r,policy)?.id===r.scopeId);
 const files=state?.published?env.SQL.exec('SELECT body FROM progress_files WHERE generation=? AND source=?',state.published,'reference').toArray().map(r=>scopedFile(JSON.parse(r.body),policy)).filter(f=>f&&policy.rows.some(a=>a.id===f.scopeId)):[];
 return {sourceName:data?.sourceName||'M1_Models_Received.xlsx',sourceCheckedAt:data?.sourceCheckedAt||null,checkedAt:state?.checkedAt||null,checking:!!state?.active,rows:compareReceived(rows,files,state?.checkedAt)};
}
