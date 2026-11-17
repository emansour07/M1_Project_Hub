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
  documents.push({id:urn,name,folderPath});
 }
 return documents;
}
export function placementDiscipline(documents){
 const names=new Set();for(const doc of documents)for(const folder of doc.folderPath||[]){const s=folder.replace(/^\d+[._ -]*/,'').trim();const match=/^(architecture|architectural|structure|structural|mechanical|electrical|civil|plumbing|fire ?fighting|landscape)$/i.exec(s);if(match){const key=match[1].toLowerCase().replace('architectural','architecture').replace('structural','structure');names.add(key[0].toUpperCase()+key.slice(1));}}
 return names.size===1?[...names][0]:'';
}

export const PROJECT_COORDINATION={id:'project-coordination',code:'Project coordination',name:'Project coordination — asset not assigned'};
export const isFederatedPlacement=documents=>documents.length>0&&documents.every(d=>/\.nwd$/i.test(d.name)&&(/-BFM-/i.test(d.name)||/fed(?:e)?rat(?:ed|ion)/i.test(d.name)||(d.folderPath||[]).some(p=>/federated models/i.test(p))));
