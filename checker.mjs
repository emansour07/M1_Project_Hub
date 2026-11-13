import {checkName} from './naming.mjs';
import {modelStem,extension} from './model-formats.mjs';
import {isProgressModel,fileDiscipline} from './progress-core.mjs';
export function checkSharedFiles(files,mapping,rules){
 const shared=files.filter(f=>['progress1','progress2'].includes(f.source)),groups=new Map();
 for(const f of shared){const key=f.source+'|'+f.folderId+'|'+modelStem(f.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
 return [...groups].map(([key,variants])=>{
  const model=variants.some(isProgressModel),formats=[...new Set(variants.map(f=>extension(f.name)))],native=variants.some(f=>extension(f.name)==='rvt'||extension(f.name)==='dwg'&&isProgressModel(f)),missing=model?['native','nwc'].filter(t=>t==='native'?!native:!formats.includes(t)):[];
  const counterparts=variants.filter(f=>['rvt','dwg','nwc'].includes(extension(f.name))&&isProgressModel(f)),versions=counterparts.map(f=>f.version).filter(v=>v!==null&&v!==undefined).map(String),versionMismatch=model&&new Set(versions).size>1;
  const documents=variants.map(f=>({...f,naming:checkName(f.name,mapping,rules),descriptionState:f.descriptionRead===true?(String(f.description||'').trim()?'Present':'Missing'):'Not checked'}));
  const issues=[];if(missing.length)issues.push('Missing formats');if(versionMismatch)issues.push('Version mismatch');if(documents.some(f=>f.descriptionState==='Missing'))issues.push('Missing description');if(documents.some(f=>f.naming.state==='warning'))issues.push('Naming');
  const pending=documents.some(f=>f.descriptionState==='Not checked'||f.naming.state==='unchecked')||(model&&counterparts.some(f=>f.version==null));
  return {key,name:modelStem(variants[0].name),scopeId:variants[0].scopeId,scopeName:variants[0].scopeName,source:variants[0].source,folderId:variants[0].folderId,folderPath:variants[0].folderPath||[],discipline:fileDiscipline(variants[0]),model,missing,versionMismatch,documents,issues,state:issues.length?'Needs attention':pending?'Not fully checked':'Passed'};
 });
}
