// Resolve an issue's linked item, not its view name, using read-only ACC metadata.
export async function issuePlacements(raw,read,cache=new Map()){
 const documents=[];
 const get=async path=>{if(!cache.has(path)){const value=await read(path),d=value?.data;cache.set(path,{data:d?{attributes:{displayName:d.attributes?.displayName,name:d.attributes?.name},relationships:{parent:d.relationships?.parent}}:null});}return cache.get(path);};
 for(const link of (raw.linkedDocuments||[]).slice(0,8)){
  const urn=String(link.urn||'').replace(/@\d+$/,'');
  if(!/^urn:adsk\.wip(?:emea|prod):dm\.lineage:[\w-]+$/.test(urn))continue;
  const base='/data/v1/projects/b.e80ed581-2f73-4b70-a8d1-f100b9b95f4d/';
  const item=(await get(base+'items/'+encodeURIComponent(urn)))?.data;if(!item)continue;
  const name=item.attributes?.displayName||item.attributes?.name;if(!name)continue;
  const folderPath=[],seen=new Set();let parent=item.relationships?.parent?.data?.id;
  for(let depth=0;parent&&depth<10;depth++){
   if(seen.has(parent))throw Error('Repeated ACC placement folder.');seen.add(parent);
   const folder=(await get(base+'folders/'+encodeURIComponent(parent)))?.data;if(!folder)break;
   const label=folder.attributes?.displayName||folder.attributes?.name;if(label)folderPath.unshift(label);
   parent=folder.relationships?.parent?.data?.id;
  }
  documents.push({id:urn,name,folderPath,viewName:String(link.details?.viewable?.name||'')});
 }
 return documents;
}
export function placementDiscipline(documents){
 const names=new Set();for(const doc of documents)for(const folder of doc.folderPath||[]){const s=folder.replace(/^\d+[._ -]*/,'').trim();const match=/^(architecture|architectural|structure|structural|mechanical|electrical|civil|plumbing|fire ?fighting|landscape)$/i.exec(s);if(match){const key=match[1].toLowerCase().replace('architectural','architecture').replace('structural','structure');names.add(key[0].toUpperCase()+key.slice(1));}}
 return names.size===1?[...names][0]:'';
}

export const PROJECT_COORDINATION={id:'project-coordination',code:'Project coordination',name:'Project coordination — asset not assigned'};
export const isFederatedPlacement=documents=>documents.length>0&&documents.every(d=>/\.nwd$/i.test(d.name)&&(/-BFM-/i.test(d.name)||/fed(?:e)?rat(?:ed|ion)/i.test(d.name)||(d.folderPath||[]).some(p=>/federated models/i.test(p))));

export const WIDE_COORDINATION=[{id:'wide-island',code:'Island-wide',name:'Island-wide — interfaces / linear disciplines',zone:'Island'},{id:'wide-mainland',code:'Mainland-wide',name:'Mainland-wide — interfaces / linear disciplines',zone:'Mainland'}];
export const coordinationScope=id=>[PROJECT_COORDINATION,...WIDE_COORDINATION].find(s=>s.id===id);
export function wideCoordination(documents){
 const zones=values=>{const found=new Set();for(const value of values){const name=String(value||''),parcel=/^M1-(102|121)-/i.exec(name)?.[1];if(parcel)found.add(parcel==='102'?'Island':'Mainland');else{if(/\bisland\b/i.test(name.replaceAll('_',' ')))found.add('Island');if(/\bmainland\b/i.test(name.replaceAll('_',' ')))found.add('Mainland');}}return found;};
 for(const evidence of [documents.map(d=>d.name),documents.flatMap(d=>d.folderPath||[]),documents.map(d=>d.viewName)]){const found=zones(evidence);if(found.size)return found.size===1?WIDE_COORDINATION.find(s=>found.has(s.zone)):null;}
 return null;
}
