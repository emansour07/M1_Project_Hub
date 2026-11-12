const text=v=>String(v??'').trim();
const upper=v=>text(v).toUpperCase();
export const SCOPE_URL='https://acc.autodesk.eu/docs/files/projects/e80ed581-2f73-4b70-a8d1-f100b9b95f4d?folderUrn=urn%3Aadsk.wipemea%3Afs.folder%3Aco.c_IFywLjRpKsXt6H-JM1IA&entityId=urn%3Aadsk.wipemea%3Adm.lineage%3AsIrhtKWeRjCdGN3fs-vrpg&viewModel=detail&moduleId=folders';
export function parseScope(rows){
 const h=rows.findIndex(r=>r.includes('Scope ID')&&r.includes('Corrected filename'));if(h<0)throw Error('Scope mapping columns were not found.');
 const header=rows[h],col=n=>header.indexOf(n),result=[];
 for(const r of rows.slice(h+1)){
  const id=text(r[col('Scope ID')]),code=upper(r[col('Scope code')]),name=text(r[col('Asset')]),zone=text(r[col('Zone')]),filename=text(r[col('Corrected filename')]);if(!id||!code||!name||!/^M1-/i.test(filename))continue;
  const original=text(r[col('Original main-folder workbook')]).split(/[\\/]/).pop(),legacy=/^M1-/i.test(original||'')?upper(original.split('-')[3]):null;
  result.push({id,code,name,zone,party:text(r[col('Party')]),parcel:upper(filename.split('-')[1]),aliases:[...new Set([code,legacy].filter(c=>c&&!['XXX','YYY','ZZZ'].includes(c)))],filename});
 }
 if(!result.length||new Set(result.map(r=>r.id)).size!==result.length)throw Error('Scope list is empty or has duplicate IDs.');return result;
}
export function scopePolicy(scopeRows,mapping){
 const rows=scopeRows.map(s=>{
  const section=s.parcel==='102'?'10.2':s.parcel==='121'?'12.1':'',local=mapping.filter(m=>!section||m.section===section);
  // The scope's main code is authoritative; historical file paths are aliases,
  // never evidence for choosing a different proposed code.
  let matches=section?local.filter(m=>m.existing===s.code):[];
  if(!matches.length&&section)matches=local.filter(m=>m.proposed===s.code);
  if(!matches.length)matches=local.filter(m=>upper(m.name)===upper(s.name));
  const unique=[...new Set(matches.map(m=>m.proposed))],proposed=unique.length===1?unique[0]:null;
  const aliases=[...new Set([...s.aliases,...(proposed&&!['XXX','YYY','ZZZ'].includes(proposed)?[proposed]:[])])];
  const ambiguous=aliases.filter(a=>mapping.some(m=>(m.existing===a||m.proposed===a)&&!matches.includes(m)));
  return {...s,section,proposed,aliases,ambiguous};
 });return {rows};
}
function zoneHint(file){
 const explicit=upper(file.parcel).replace(/[^0-9]/g,'');if(explicit==='102')return 'Island';if(explicit==='121')return 'Mainland';const p=upper(file.name).split('-')[1];if(p==='102')return 'Island';if(p==='121')return 'Mainland';if(p==='YYY'&&/^M1-YYY-[A-Z0-9]+-SS[12]-/i.test(file.name))return 'Subsea';
 const path=(file.folderPath||[]).join(' ');return /\bmainland\b/i.test(path)?'Mainland':/\bisland\b/i.test(path)?'Island':/\bsubsea\b/i.test(path)?'Subsea':null;
}
export function scopeMatch(file,policy){
 if(!policy?.rows?.length)return null;
 const zone=zoneHint(file),rows=policy.rows.filter(r=>!zone||r.zone===zone),parts=upper(file.name).split('-'),isName=parts[0]==='M1'&&parts.length>=6,asset=isName?parts[3]:null;
 const pick=(code,context=false)=>rows.filter(r=>r.aliases.includes(code)&&(zone||context||!r.ambiguous.includes(code)||r.proposed===code));
 if(asset&&!['XXX','YYY','ZZZ'].includes(asset)){
  const found=pick(asset);if(found.length===1)return found[0];
  // Folder context can disambiguate a reused old code, but cannot override a
  // confidently out-of-scope asset written in a valid document filename.
  if(!found.length&&!rows.some(r=>r.aliases.includes(asset))&&!['ROD','EWK','UTL'].includes(asset))return null;
 }
 const tokens=(file.folderPath||[]).flatMap(p=>upper(p).split(/[^A-Z0-9]+/));
 const found=[...new Set(tokens.flatMap(t=>pick(t,true)))];
 if(found.length===1&&(!asset||['XXX','YYY','ZZZ'].includes(asset)||found[0].aliases.includes(asset)))return found[0];
 const context=upper([file.name,file.description,...(file.folderPath||[])].join(' '));
 let category=null;
 if(/EARTHWORK|GRADING|SITE.CLEARANCE|\bEWK\b|\bGB001\b/.test(context))category='EW-GRD';
 else if(/\bROD\b|\bRDI\b|\bBM015\b|ROADS?|FENCING/.test(context))category='EW-ROD';
 else if(/LANDSCAP|SOFTSCAPE|HARDSCAPE|\bBM032\b|\bBM021\b/.test(context))category='EW-LAN';
 else if(/UTILIT|\bUTL\b|\bBM016\b/.test(context))category='EW-UTL';
 if(category&&(!asset||['XXX','YYY','ZZZ','ROD','EWK','UTL'].includes(asset))){const candidates=rows.filter(r=>r.code===category);if(candidates.length===1)return candidates[0];if(candidates.length>1)return {id:'Unassigned-'+category,code:category,proposed:null,name:candidates[0].name+' (zone to confirm)'};}
 return null;
}
export function scopedFile(file,policy){const match=scopeMatch(file,policy);return match?{...file,scopeId:match.id,scopeAsset:match.proposed&&!['XXX','YYY','ZZZ'].includes(match.proposed)?match.proposed:match.id,scopeName:match.name}:null;}
export function scopedMapping(policy){return (policy?.rows||[]).map(r=>({section:r.section||r.zone,existing:r.code,proposed:r.proposed||r.code,name:r.name,scopeId:r.id,mappingPending:!r.proposed,ambiguous:r.ambiguous}));}
export async function getScope(env){return await(await env.BUCKET.get('m1/scope'))?.json()||null;}
export function visitScopeFolder(name,trail,policy){
 if(!policy)return false;
 const named=/^(?:(102|121)[ _-])([A-Z0-9]{2,5})(?:[ _-]|$)/i.exec(name);
 if(named)return !!scopeMatch({name:'M1-'+named[1]+'-REF-'+named[2]+'-00-REF',folderPath:trail},policy);
 // A bare asset code at the root of a source tree is an asset folder. Other
 // folders (discipline, stage, format, etc.) are traversal structure.
 if(trail.length===0&&/^[A-Z]{1,3}\d{1,2}$/i.test(name))return policy.rows.some(r=>r.aliases.includes(upper(name)));
 return true;
}
export function scopedReview(review,policy){const files=(review.files||[]).map(f=>scopedFile({...f,folderPath:[f.path||'',review.name||'']},policy)).filter(Boolean);return files.length?{...review,files}:null;}
export function scopedSnapshot(snapshot,policy){return snapshot?{...snapshot,reviews:(snapshot.reviews||[]).map(r=>scopedReview(r,policy)).filter(Boolean),voidCount:0,uniqueCount:undefined}:snapshot;}
export async function pruneScopeCache(env,limit=500){
 const policy=await getScope(env);if(!policy)return {pending:true};
 env.SQL.exec("DELETE FROM objects WHERE key LIKE 'm1/models/%'");
 let checked=0,removed=0;
 for(const table of ['progress_files','format_files']){
  if(!env.SQL.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table).toArray().length)continue;
  const stateKey=table==='progress_files'?'m1/progress/state':'m1/formats/state',state=await(await env.BUCKET.get(stateKey))?.json();if(state){const queue=table==='progress_files'?'progress_queue':'format_queue';env.SQL.exec('DELETE FROM '+queue+' WHERE generation<>?',state.active?state.generation:'');env.SQL.exec('DELETE FROM '+table+' WHERE generation<>? AND generation<>?',state.published||'',state.active?state.generation:'');}
  const marker='m1/scope-prune/'+table,old=await(await env.BUCKET.get(marker))?.json(),cursor=old?.version===policy.revision?old.cursor:0;
  const batch=env.SQL.exec('SELECT rowid,body FROM '+table+' WHERE rowid>? ORDER BY rowid LIMIT ?',cursor,limit).toArray();
  for(const r of batch){const f=scopedFile(JSON.parse(r.body),policy);if(!f){env.SQL.exec('DELETE FROM '+table+' WHERE rowid=?',r.rowid);removed++;}else env.SQL.exec('UPDATE '+table+' SET body=? WHERE rowid=?',JSON.stringify(f),r.rowid);checked++;}
  await env.BUCKET.put(marker,JSON.stringify({version:policy.revision,cursor:batch.at(-1)?.rowid||cursor}));
 }
 for(const key of ['tracker','midp']){const path='m1/workbooks/'+key,saved=await(await env.BUCKET.get(path))?.json();if(saved)await env.BUCKET.put(path,JSON.stringify({...saved,rows:saved.rows.map(r=>scopedFile(r,policy)).filter(Boolean)}));}
 const key='m1/shared-snapshot-v2.json',saved=await(await env.BUCKET.get(key))?.json();if(saved){const next={...saved,current:scopedSnapshot(saved.current,policy),previous:null};if(JSON.stringify(next)!==JSON.stringify(saved))await env.BUCKET.put(key,JSON.stringify(next));}
 return {checked,removed,pending:checked>=limit};
}

export async function scopeStatus(env){const policy=await getScope(env),tables=[];for(const table of ['progress_files','format_files']){if(!env.SQL.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table).toArray().length)continue;const files=env.SQL.exec('SELECT body FROM '+table).toArray();tables.push({table,saved:files.length,outsideScope:files.filter(r=>!scopedFile(JSON.parse(r.body),policy)).length});}return {source:policy?.source,scopeEntries:policy?.rows.length||0,tables};}
