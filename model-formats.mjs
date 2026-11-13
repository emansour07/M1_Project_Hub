export const modelStem=name=>String(name||'').trim().replace(/\.[^.]+$/,'').toUpperCase();
export const extension=name=>String(name||'').split('.').pop().toLowerCase();
export function groupModels(files,isModel){
 const groups=new Map();
 for(const f of files){if(!isModel(f))continue;const key=modelStem(f.name);if(!groups.has(key))groups.set(key,[]);const variants=groups.get(key);if(!variants.some(v=>v.id===f.id&&v.source===f.source))variants.push(f);}
 return [...groups].map(([key,variants])=>{
  const native=variants.filter(f=>['rvt','dwg'].includes(extension(f.name)));
  const candidates=native.length?native:variants;
  // An older native file must not be hidden by a freshly exported derivative.
  const representative=[...candidates].sort((a,b)=>(Date.parse(a.updatedAt)||0)-(Date.parse(b.updatedAt)||0))[0];
  const locations=[...new Set(variants.map(f=>f.source+'|'+(f.folderId||'')))].map(location=>{
   const members=variants.filter(f=>f.source+'|'+(f.folderId||'')===location),source=members[0].source,formats=[...new Set(members.map(f=>extension(f.name)))];
   const stage=source==='review'?'Review':'Shared',required=source==='review'?['native','nwc','ifc','dwfx']:['native','nwc'];
   const missing=required.filter(format=>format==='native'?!formats.some(x=>x==='rvt'||x==='dwg'):!formats.includes(format));
   return {source,folderId:members[0].folderId,folderPath:members[0].folderPath,stage,formats,missing};
  });
  return {...representative,modelKey:key,formats:[...new Set(variants.map(f=>extension(f.name)))].sort(),variants,locations};
 });
}
