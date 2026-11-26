import {NEW_ASSET_CODES,confirmedCodeScope} from './asset-code-policy.mjs';
import {documentKey,submissionResolver} from './submissions-core.mjs';

const known=v=>v&&!/^(?:unclassified|unknown|general|not provided)$/i.test(v);
// A road-folder DWG can be a drawing. Require model naming or a tracker file link.
const modelEvidence=(f,trackerIds)=>/\.(rvt|ifc|nwc|nwd)$/i.test(f.name)||(/\.(dwg|dwfx)$/i.test(f.name)&&(/-(?:BM[A-Z0-9]+|BNM|BGM|BFM|C3D)-/i.test(f.name)||trackerIds.has(f.id)));
export function codeImpact({models={},midp={},tracker={},scope={}}={}){
 const assets=confirmedCodeScope(scope.rows||[]),byAsset=new Map(assets.map(a=>[a.id,a]));
 const resolve=submissionResolver(midp.entries||[],assets),modelsByKey=new Map();
 const trByRow=new Map((tracker.rows||[]).map(r=>[r.row,r])),trackerIds=new Set((tracker.rows||[]).flatMap(r=>(r.files||[]).map(f=>f.id)));
 for(const f of models.scan?.files||[]){
  if(!byAsset.has(f.scopeId)||f.scopeId==='Island-A51')continue;
  const variants=(f.variants?.length?f.variants:[f]).filter(v=>['progress1','progress2','review'].includes(v.source||f.source)&&modelEvidence(v,trackerIds));
  if(!variants.length)continue;
  const asset=byAsset.get(f.scopeId),p=documentKey(f.name).split('-');
  // Asset identity is supplied by the scoped scan. Formats and revisions share one model.
  if(p.length===9){p[1]=asset.parcel;p[2]=p[2]==='ARX'?'SAP':p[2];p[3]=asset.id;}
  const key=f.scopeId+'::'+p.join('-');
  const matches=resolve(f.name).filter(e=>e.scopeId===f.scopeId),disciplines=[...new Set(matches.map(e=>e.discipline).filter(known))];
  const tr=trByRow.get(f.trackerRow),discipline=tr?.scopeId===f.scopeId&&known(tr.discipline)?tr.discipline:disciplines.length===1?disciplines[0]:known(f.discipline)?f.discipline:'Unclassified';
  if(!modelsByKey.has(key))modelsByKey.set(key,{key,scopeId:f.scopeId,asset:asset.code,name:asset.name,zone:asset.zone,discipline,newCode:NEW_ASSET_CODES[f.scopeId]||'',files:[]});
  const m=modelsByKey.get(key);for(const v of variants)if(!m.files.some(x=>x.id===v.id&&x.name===v.name&&x.source===(v.source||f.source)))m.files.push({...v,source:v.source||f.source,code:documentKey(v.name).split('-')[3]||''});
 }
 const groups=new Map();for(const m of modelsByKey.values()){
  m.currentCodes=[...new Set(m.files.map(f=>f.code))].sort();
  m.affectedFiles=m.newCode?m.files.filter(f=>f.code!==m.newCode):[];
  m.status=!m.newCode?'Code awaiting confirmation':m.affectedFiles.length?'Code change affects existing models':'Already uses new code';
  const key=m.scopeId+'::'+m.discipline;if(!groups.has(key))groups.set(key,{scopeId:m.scopeId,asset:m.asset,name:m.name,zone:m.zone,discipline:m.discipline,newCode:m.newCode,models:[]});groups.get(key).models.push(m);
 }
 const rows=[...groups.values()].map(g=>({...g,currentCodes:[...new Set(g.models.flatMap(m=>m.currentCodes))].sort(),total:g.models.length,affected:g.models.filter(m=>m.affectedFiles.length).length,files:g.models.reduce((n,m)=>n+m.affectedFiles.length,0),status:!g.newCode?'Code awaiting confirmation':g.models.some(m=>m.affectedFiles.length)?'Code change affects existing models':'Already uses new code'})).sort((a,b)=>a.scopeId.localeCompare(b.scopeId)||a.discipline.localeCompare(b.discipline));
 return {rows,checkedAt:models.scan?.checkedAt||null,complete:models.scan?.complete===true,total:modelsByKey.size,affectedModels:[...modelsByKey.values()].filter(m=>m.affectedFiles.length).length,affectedGroups:rows.filter(r=>r.affected).length,affectedAssets:new Set(rows.filter(r=>r.affected).map(r=>r.scopeId)).size,pendingModels:[...modelsByKey.values()].filter(m=>!m.newCode).length};
}

export function trackerActive(r){return Number(r.log)>0||Number(r.loi)>0||['L','R','X','AD','deliveryStatus'].some(k=>/^(?:in progress|submitted|active)$/i.test(String(r.fields?.[k]||'').trim()));}
