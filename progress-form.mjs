import {canEditRow,canEditField} from './editor-auth.mjs';
import {validateChanges,initDrafts} from './tracker-drafts.mjs';
export function progressColumns(columns){return columns.filter(c=>['deliveryStatus','overallCompletion','targetDate','blocker'].includes(c.key)||!c.hidden&&/^(LOG|LOI)\s*%$/i.test(c.label));}
export function progressWorkspace(tracker,user,drafts){
 const columns=progressColumns(tracker.columns),rows=tracker.rows.filter(r=>canEditRow(user,r));
 return {user,date1904:!!tracker.date1904,sourceVersion:tracker.source?.version,source:tracker.source,columns:columns.map(c=>({...c,editable:canEditField(user,c.key)&&!c.readonly})),rows:rows.map(r=>({id:r.id,name:r.name,description:r.description,scopeName:r.scopeName,scopeId:r.scopeId,discipline:r.discipline,fields:r.fields,formulaFields:r.formulaFields||[]})),drafts:drafts.map(d=>({id:d.id,rowId:d.rowId,status:d.status,changes:d.changes,updatedAt:d.updatedAt,email:d.email})),approvalUrl:'/editor'};
}
export function prepareProgressDrafts(tracker,user,input,now=Date.now()){
 if(!tracker.source?.version||input?.sourceVersion!==tracker.source.version)throw Error('The tracker changed or is not loaded. Reload the form before submitting.');
 if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>100)throw Error('Submit between 1 and 100 changed models at a time.');
 const seen=new Set(),ids=new Set(),allowed=new Set(progressColumns(tracker.columns).map(c=>c.key));
 return input.rows.map(item=>{
  const row=tracker.rows.find(r=>r.id===item.rowId);if(!row||seen.has(item.rowId)||!/^[-a-f0-9]{36}$/i.test(item.requestId||'')||ids.has(item.requestId))throw Error('Check the model selection and reload the form.');seen.add(item.rowId);ids.add(item.requestId);
  if(Object.keys(item.changes||{}).some(k=>!allowed.has(k)))throw Error('This field is not part of the progress form.');
  const changes=validateChanges(user,row,tracker.columns,item.changes);
  return {id:item.requestId,email:user.email,status:'pending',rowId:row.id,name:row.name,scopeId:row.scopeId,discipline:row.discipline,row:row.row,missingFromTracker:row.missingFromTracker,sourceVersion:tracker.source.version,baseFields:Object.fromEntries(Object.keys(changes).map(k=>[k,row.fields[k]??null])),changes,createdAt:now,updatedAt:now,source:'progress-form'};
 });
}
export function storeProgressDrafts(env,drafts){
 initDrafts(env);const prepared=drafts.map(d=>{const old=env.SQL.exec('SELECT body FROM tracker_drafts WHERE id=?',d.id).toArray()[0];if(!old)return {draft:d,exists:false};const saved=JSON.parse(old.body);if(saved.email!==d.email||saved.rowId!==d.rowId||saved.sourceVersion!==d.sourceVersion||JSON.stringify(saved.changes)!==JSON.stringify(d.changes))throw Error('This submission reference was already used. Reload before making another update.');return {draft:saved,exists:true};});
 for(const {draft:d,exists} of prepared)if(!exists)env.SQL.exec('INSERT INTO tracker_drafts VALUES(?,?,?,?,?)',d.id,d.email,d.status,JSON.stringify(d),d.updatedAt);
 return {saved:prepared.length,drafts:prepared.map(x=>({id:x.draft.id,rowId:x.draft.rowId,status:x.draft.status}))};
}
