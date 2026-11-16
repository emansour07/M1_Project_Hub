export const RECEIVED_FORMATS=['native','nwc','ifc','dwfx'];
export function receivedMatrix(rows){
 const groups=new Map();let pending=0;
 for(const r of rows){if(r.assetAssignmentPending){pending++;continue;}const key=JSON.stringify([r.scopeId,r.discipline]);
  if(!groups.has(key))groups.set(key,{key,scopeId:r.scopeId,asset:r.asset,assetName:r.assetName,zone:r.zone,discipline:r.discipline,rows:[],expected:0,received:0,complete:0,missingModels:0,missingFormats:0,unassessed:0});
  const g=groups.get(key);g.rows.push(r);g.expected++;if(r.accFormats===null||r.status==='Not checked'){g.unassessed++;continue;}
  if(r.accFormats>0)g.received++;else g.missingModels++;
  if(r.accFormats===4)g.complete++;
  g.missingFormats+=RECEIVED_FORMATS.filter(f=>!r.formats[f].matches.length).length;
 }
 return {pending,cells:[...groups.values()].map(g=>({...g,state:g.unassessed?'Not checked':g.complete===g.expected?'Complete':g.received?'Partial':'Missing'}))};
}
export function receivedFormat(name){const ext=String(name).split('.').pop().toLowerCase();return ['rvt','dwg'].includes(ext)?'native':RECEIVED_FORMATS.includes(ext)?ext:null;}
// BNM/BGM is one workbook expectation with two permitted file-name variants.
// Keep originator, stage, discipline, level and document number distinct.
export function receivedKey(name,scopeId){const p=String(name).trim().toUpperCase().replace(/\.(RVT|DWG|NWC|IFC|DWFX)$/,'').replace(/-(RVT|DWG|NWC|IFC|DWFX)$/,'').replace(/-$/,'').replace(/-R\d+$/,'').split('-');if(p.length!==9||p[0]!=='M1')return null;if(scopeId!=='pending'){p[1]='SCOPE';p[3]=scopeId;}if(p[2]==='ARX')p[2]='SAP';if(['BNM/BGM','BNM','BGM'].includes(p[6]))p[6]='BNM';return p.join('-');}
export function compareReceived(rows,files,checkedAt){
 const index=new Map();for(const f of files){const format=receivedFormat(f.name),key=receivedKey(f.name,f.scopeId);if(!key||!format)continue;const k=key+'|'+format;if(!index.has(k))index.set(k,[]);index.get(k).push(f);}
 const unique=new Map();for(const r of rows){const key=receivedKey(r.name,r.scopeId);if(!key)continue;const old=unique.get(key);if(old){old.source=[...new Set([...old.source,r.source])];for(const f of RECEIVED_FORMATS)old.formats[f].sourceAvailable ||= !!r.formats?.[f]?.sourceAvailable;continue;}unique.set(key,{...r,key,source:[r.source],formats:Object.fromEntries(RECEIVED_FORMATS.map(format=>{const matches=index.get(key+'|'+format)||[];return [format,{sourceAvailable:!!r.formats?.[format]?.sourceAvailable,workbookReceived:!!r.formats?.[format]?.workbookReceived,matches:matches.map(f=>({id:f.id,name:f.name,folderId:f.folderId,updatedAt:f.updatedAt,version:f.version})),state:matches.length?'In ACC':!checkedAt?'Not checked':r.formats?.[format]?.sourceAvailable?'Source available':'Not found'}];}))});}
 return [...unique.values()].map(r=>{if(r.assetAssignmentPending)return {...r,accFormats:null,status:'Asset assignment pending',formats:Object.fromEntries(RECEIVED_FORMATS.map(f=>[f,{...r.formats[f],matches:[],state:'Not checked'}]))};const n=RECEIVED_FORMATS.filter(f=>r.formats[f].matches.length).length,source=RECEIVED_FORMATS.some(f=>r.formats[f].sourceAvailable&&!r.formats[f].matches.length);return {...r,accFormats:n,status:!checkedAt?'Not checked':n===4?'All formats in ACC':n?'Partial in ACC':source?'Source only':'Not found in ACC'};});
}
