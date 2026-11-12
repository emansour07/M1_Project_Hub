import {leadColumns} from './tracker-fields.mjs';
import {workbookSnapshot,midpSnapshot} from './workbooks.mjs';
import {progressSnapshot} from './progress.mjs';
import {canonicalFilename} from './asset-codes.mjs';
import {fileDiscipline} from './progress-core.mjs';
import {deliverableCategory} from './delivery-core.mjs';
export function modelIdentity(row,mapping=[]){const parts=canonicalFilename(row.name,mapping).split('-');if(parts[2]==='ARX')parts[2]='SAP';if(row.scopeAsset&&parts[0]==='M1'){parts[1]='FXX';parts[3]=row.scopeAsset;}return (row.scopeId?row.scopeId+'::':'')+parts.join('-');}
export function buildTracker(tracker,midp,scan,mapping=[]){
 const columns=[...(tracker?.columns||[]),...leadColumns.filter(c=>!(tracker?.columns||[]).some(x=>x.key===c.key))],expected=new Map(),known=new Set(),files=new Map();
 for(const r of midp?.entries||[])if(deliverableCategory(r)==='Models'){const key=modelIdentity(r,mapping);if(!expected.has(key))expected.set(key,r);}
 for(const f of scan?.files||[]){const key=modelIdentity({...f,scopeAsset:f.scopeAsset||f.asset},mapping);if(!files.has(key))files.set(key,[]);files.get(key).push(f);}
 const rows=(tracker?.rows||[]).map(r=>{const key=modelIdentity(r,mapping);known.add(key);return {...r,id:'tracker:'+r.row,key,origin:'Excel tracker',missingFromTracker:false,discipline:fileDiscipline(r),midp:expected.has(key),midpName:expected.get(key)?.name||null,midpNamingCorrection:!!expected.get(key)&&expected.get(key).name.replace(/-R[0-9]+$/i,'')!==r.name.replace(/-R[0-9]+$/i,''),suggestedMidpName:expected.has(key)?r.name.replace(/-R[0-9]+$/i,'')+(expected.get(key).name.match(/-R[0-9]+$/i)?.[0]||''):null,files:(files.get(key)||[]).map(f=>({name:f.name,id:f.id,folderId:f.folderId,updatedAt:f.updatedAt,formats:f.formats}))};});
 for(const [key,r] of expected)if(!known.has(key)){
  const fields=Object.fromEntries(columns.map(c=>[c.key,/^name$/i.test(c.label)?r.name:/^description$/i.test(c.label)?r.description:/^parcel$/i.test(c.label)?r.name.split('-')[1]:null]));
  rows.push({...r,id:'midp:'+r.id,key,fields,row:null,origin:'MIDP — not in tracker',missingFromTracker:true,discipline:fileDiscipline({...r,folderPath:[r.discipline]}),log:null,loi:null,midp:true,files:(files.get(key)||[]).map(f=>({name:f.name,id:f.id,folderId:f.folderId,updatedAt:f.updatedAt,formats:f.formats}))});
 }
 return {source:tracker?.source||null,date1904:!!tracker?.date1904,columns,rows,expectedModels:expected.size,missingFromTracker:rows.filter(r=>r.missingFromTracker).length};
}
export async function trackerSnapshot(env){const [tracker,midp,models,mapping]=await Promise.all([workbookSnapshot(env,'tracker'),midpSnapshot(env),progressSnapshot(env),workbookSnapshot(env,'tidp')]);return buildTracker(tracker,midp,models.scan,mapping?.rows||[]);}
