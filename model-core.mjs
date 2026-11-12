const MODEL=/\.(rvt|ifc|nwc|nwd)$/i;
const norm=s=>String(s||'').trim().normalize('NFKC').toLowerCase();
export function validBaseline(b){
 if(!b||!Array.isArray(b.assets)||!Array.isArray(b.disciplines)||!Array.isArray(b.requirements))throw Error('A baseline needs assets, disciplines and requirements.');
 for(const [type,rows] of [['asset',b.assets],['discipline',b.disciplines]]){const ids=new Set();for(const r of rows){if(!r.id||!r.name||ids.has(r.id))throw Error('Invalid or duplicate '+type+'.');ids.add(r.id);}}
 const ids=new Set(),assets=new Set(b.assets.map(x=>x.id)),disciplines=new Set(b.disciplines.map(x=>x.id));
 for(const r of b.requirements){if(!r.id||ids.has(r.id)||!assets.has(r.asset)||!disciplines.has(r.discipline)||typeof r.required!=='boolean')throw Error('Invalid requirement.');ids.add(r.id);
 if(r.required&&(!Array.isArray(r.names)||!r.names.length||r.names.some(n=>typeof n!=='string'||!MODEL.test(n))))throw Error('Each required deliverable needs one or more accepted model filenames.');
 }
 const cells=new Map();for(const r of b.requirements){const k=r.asset+'|'+r.discipline;if(cells.has(k)&&cells.get(k)!==r.required)throw Error('A cell cannot be required and not required.');cells.set(k,r.required);}
 const required=b.requirements.filter(r=>r.required);for(let i=0;i<required.length;i++)for(let j=i+1;j<required.length;j++){const a=required[i],c=required[j];if(a.asset===c.asset&&a.discipline===c.discipline&&(!a.folderId||!c.folderId||a.folderId===c.folderId)&&a.names.some(n=>c.names.some(m=>norm(n)===norm(m))))throw Error('The same model cannot satisfy two baseline deliverables.');}return b;
}
export function buildMatrix(baseline,scan){
 validBaseline(baseline);const files=(scan?.files||[]).filter(f=>MODEL.test(f.name));const mapped=new Set();
 const cells=[];for(const asset of baseline.assets)for(const discipline of baseline.disciplines){
  const requirements=baseline.requirements.filter(r=>r.asset===asset.id&&r.discipline===discipline.id),required=requirements.filter(r=>r.required);
  const evidence=required.map(r=>({id:r.id,label:r.label||r.id,names:r.names,files:files.filter(f=>r.names.some(n=>norm(n)===norm(f.name))&&(!r.folderId||f.folderId===r.folderId))}));
  for(const e of evidence)for(const f of e.files)mapped.add(f.id);
  const found=evidence.filter(e=>e.files.length).length;
  // An absent requirement is unknown, never an implicit exemption.
  const state=!requirements.length?'Not checked':!required.length?'Not required':!scan?.complete?'Not checked':found===required.length?'Available':found?'Partial':'Missing';
  cells.push({asset:asset.id,assetName:asset.name,discipline:discipline.id,disciplineName:discipline.name,state,found,expected:required.length,evidence});
 }
 return {cells,unmapped:files.filter(f=>!mapped.has(f.id)),checkedAt:scan?.checkedAt||null,complete:!!scan?.complete};
}
export function modelSummary(cells){const result={Available:0,Partial:0,Missing:0,'Not checked':0,'Not required':0};for(const c of cells)result[c.state]++;const denominator=cells.filter(c=>c.expected>0).length;return {...result,required:denominator,percentage:denominator&&cells.every(c=>!c.expected||c.state!=='Not checked')?Math.round(result.Available/denominator*100):null};}
