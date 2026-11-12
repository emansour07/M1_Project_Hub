const code=value=>String(value??'').trim().toUpperCase();
// Keep ambiguous legacy codes unresolved: one old section can describe several assets.
export function resolveAsset(value,rows,namespace='either'){
 const key=code(value);if(!key||['XXX','YYY','ZZZ'].includes(key))return {code:null,candidates:[]};
 const candidates=[...new Set(rows.filter(r=>(namespace!=='existing'&&code(r.proposed)===key)||(namespace!=='proposed'&&code(r.existing)===key)).map(r=>r.proposed))];
 return {code:candidates.length===1?candidates[0]:null,candidates};
}
export function assetFromFilename(name,rows,namespace='either'){
 const parts=String(name||'').toUpperCase().split('-');
 return parts[0]==='M1'&&parts.length>=6?resolveAsset(parts[3],rows,namespace):{code:null,candidates:[]};
}
export function canonicalFilename(name,rows){
 const parts=String(name||'').trim().toUpperCase().replace(/\.[^.]+$/,'').replace(/-R\d+$/,'').split('-');
 if(parts[0]==='M1'&&parts.length>=6){const asset=resolveAsset(parts[3],rows);if(asset.code)parts[3]=asset.code;}
 return parts.join('-');
}
