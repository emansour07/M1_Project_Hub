import {exportConsolidated} from './midp-export.mjs';
import {deliverableCategory} from './delivery-core.mjs';
import {Unzip,UnzipInflate,unzipSync,strFromU8,zipSync,strToU8} from 'fflate';
import {parseMidpDeliverables,inDateRange,dateRange} from './midp.mjs';
import {scopeMatch,scopedFile} from './scope.mjs';
export const TIDP_FOLDER='urn:adsk.wipemea:fs.folder:co.3hNWncQDQZqVV9YPTm7Pyg';
export const tidpUrl=(item='',project='e80ed581-2f73-4b70-a8d1-f100b9b95f4d')=>'https://acc.autodesk.eu/docs/files/projects/'+project+'?folderUrn='+encodeURIComponent(TIDP_FOLDER)+(item?'&entityId='+encodeURIComponent(item):'');
const text=v=>String(v??'').trim();
const decode=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export const escapeXml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const plain=s=>[...s.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
const elements=(xml,tag)=>[...xml.matchAll(new RegExp('<'+tag+'\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/'+tag+'>)','g'))].map(m=>m[0]);
// Some source sheets format all 16,384 Excel columns. Stream their XML and retain
// the delivery area only, rather than allocating the expanded workbook in memory.
function readParts(bytes){
 const parts={};let total=0,failure=null;
 const unzip=new Unzip(file=>{
  if(!/^(?:\[Content_Types\].xml|_rels\/.rels|xl\/(?:workbook.xml|_rels\/workbook.xml.rels|sharedStrings.xml|styles.xml|theme\/theme1.xml|worksheets\/sheet\d+.xml))$/.test(file.name))return;
  let pending='',result='',inRows=false,doneRows=false,size=0;const decoder=new TextDecoder(),sheet=file.name.includes('/worksheets/');
  const trim=raw=>raw.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,c=>{const address=/\br="([A-Z]+)\d+"/.exec(c)?.[1];return address&&(col(address)>255||col(address)>63&&!/<(?:v|f|is)\b/.test(c))?'':c;});
  file.ondata=(error,data,final)=>{if(error){failure=error;return;}if(failure)return;size+=data.length;total+=data.length;if(size>128000000||total>256000000){failure=Error('TIDP exceeds the workbook size limit.');return;}pending+=decoder.decode(data,{stream:!final});
   if(sheet){if(!inRows&&!doneRows){const start=pending.indexOf('<sheetData');if(start>=0){const end=pending.indexOf('>',start);if(end>=0){result+=pending.slice(0,end+1);pending=pending.slice(end+1);inRows=true;}}}
    if(inRows){while(true){const start=pending.indexOf('<row');if(start<0)break;const tagEnd=pending.indexOf('>',start);if(tagEnd<0)break;const end=pending[tagEnd-1]==='/'?tagEnd+1:pending.indexOf('</row>',tagEnd);if(end<0)break;const stop=pending[tagEnd-1]==='/'?end:end+6;result+=trim(pending.slice(start,stop));pending=pending.slice(stop);}if(pending.includes('</sheetData>')){inRows=false;doneRows=true;}if(pending.length>6000000){failure=Error('TIDP row exceeds the reader limit.');return;}}
   }
   if(final){result+=pending;parts[file.name]=sheet?result.replace(/<col\b[^>]*\/>/g,t=>{const a=attrs(t);if(+a.min>256)return '';return +a.max>256?t.replace(/max="\d+"/,'max="256"'):t;}).replace(/<dimension\b[^>]*\/>/,''):result;if(parts[file.name].length>10000000)failure=Error('TIDP delivery content exceeds the reader limit.');}
  };file.start();
 });unzip.register(UnzipInflate);for(let i=0;i<bytes.length;i+=2048){unzip.push(bytes.subarray(i,i+2048),i+2048>=bytes.length);if(failure)throw failure;}if(failure)throw failure;return parts;
}
export function compactTidp(bytes){return zipSync(Object.fromEntries(Object.entries(readParts(bytes)).map(([k,v])=>[k,strToU8(v)])),{level:1});}
export function sourceScope(name,policy){
 const direct=policy.rows.filter(r=>r.filename.toUpperCase()===name.toUpperCase());
 return direct.length===1?direct[0]:scopeMatch({name,folderPath:[name.replaceAll('_',' ')]},policy);
}
export function introductionScope(bytes,source,policy){
 const known=sourceScope(source.name,policy);if(known)return known;
 const meta=unzipSync(bytes,{filter:f=>['xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/sharedStrings.xml'].includes(f.name)&&f.originalSize<10000000}),xml=k=>meta[k]?strFromU8(meta[k]):'';
 const intro=elements(xml('xl/workbook.xml'),'sheet').map(attrs).find(a=>a.name==='Introduction');if(!intro)return null;
 const target=elements(xml('xl/_rels/workbook.xml.rels'),'Relationship').map(attrs).find(a=>a.Id===intro['r:id'])?.Target;if(!target)return null;
 const path=target.startsWith('/')?target.slice(1):'xl/'+target;if(path.includes('..'))return null;
 const part=unzipSync(bytes,{filter:f=>f.name===path&&f.originalSize<1000000})[path];if(!part)return null;
 const strings=elements(xml('xl/sharedStrings.xml'),'si').map(plain);let description='';
 for(const row of elements(strFromU8(part),'row')){const values=elements(row,'c').map(c=>{const a=attrs(c.split('>')[0]+'>'),v=/<v>(.*?)<\/v>/.exec(c)?.[1];return a.t==='s'?strings[+v]:plain(c)||decode(v||'');});const i=values.findIndex(v=>/^Asset\s*\/\s*Building$/i.test(text(v)));if(i>=0){description=values.slice(i+1).join(' ');break;}}
 const formerly=/\bFormerly\s+([^)]*)/i.exec(description)?.[1],code=source.name.toUpperCase().split('-')[3];if(!formerly||!code||['XXX','YYY','BIM','GEN'].includes(code))return null;
 const old=formerly.toUpperCase().split(/[^A-Z0-9]+/),zone=/\bSubsea\b/i.test(description)?'Subsea':/\bMainland\b/i.test(description)?'Mainland':/\bIsland\b/i.test(description)?'Island':null;
 const candidates=policy.rows.filter(s=>(!zone||s.zone===zone)&&old.some(c=>s.aliases.includes(c)||s.code===c));
 if(candidates.length!==1)return null;
 return {...candidates[0],proposed:code,aliases:[...new Set([...candidates[0].aliases,code])],mappingEvidence:description};
}
export function extractTidp(bytes,source,policy){
 const context=introductionScope(bytes,source,policy);if(!context)return {source,entries:[],sheets:[],styles:"",theme:""};
 policy={...policy,rows:policy.rows.map(s=>s.id===context.id?context:s)};
 const parts=readParts(bytes);const xml=k=>parts[k]||'',strings=elements(xml('xl/sharedStrings.xml'),'si').map(plain),wb=xml('xl/workbook.xml');
 if(/date1904="(?:1|true)"/.test(wb))throw Error('TIDP uses a different date system. Convert its date system before merging.');
 const targets=new Map(elements(xml('xl/_rels/workbook.xml.rels'),'Relationship').map(t=>{const a=attrs(t);return [a.Id,a.Target];})),sheets=[],entries=[];
 if(!context)return {source,entries:[],sheets:[],styles:'',theme:''};
 for(const tag of elements(wb,'sheet')){
  const a=attrs(tag),target=targets.get(a['r:id']),path=target?.startsWith('/')?target.slice(1):'xl/'+target;
  if(!path||path.includes('..'))throw Error('Invalid TIDP worksheet path.');const sheetXml=xml(path);if(!sheetXml)continue;
  const rows=[],rowXml=elements(sheetXml,'row');if(rowXml.length>10000)throw Error('TIDP exceeds the row limit.');
  for(const raw of rowXml){const n=+attrs(raw.split('>')[0]+'>').r;if(n>10000)throw Error('TIDP exceeds the row limit.');const values=[];for(const cell of elements(raw,'c')){const at=attrs(cell.split('>')[0]+'>'),c=col((at.r||'').replace(/\d/g,''));if(c<0||c>255)continue;const v=/<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];values[c]=at.t==='s'?strings[+v]:at.t==='inlineStr'?plain(cell):v===undefined?null:at.t==='str'||at.t==='e'?decode(v):Number(v);}rows[n-1]=values;}
  for(let i=0;i<rows.length;i++)rows[i]||=[];
  const parsed=parseMidpDeliverables(rows,a.name).map(r=>{
   const mapped=scopedFile({...r,folderPath:[context.zone,context.code,source.name.replaceAll('_',' '),a.name]},policy);
   if(!mapped)return null;return {...mapped,id:source.itemId+'!'+r.id,sourceId:source.itemId,sourceName:source.name,sourceVersion:source.version,sourceUrl:tidpUrl(source.itemId),discipline:r.discipline||a.name};
  }).filter(Boolean);
  if(!parsed.length)continue;
  const wanted=new Set(parsed.map(r=>r.row)),last=Math.max(...wanted);
  let clean=sheetXml.replace(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g,raw=>{const n=+attrs(raw.split('>')[0]+'>').r;if(n>last)return '';if(/^M1-/i.test(text(rows[n-1]?.[0]))&&!wanted.has(n))return '<row r="'+n+'" hidden="1"/>';return raw;});
  clean=clean.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,cell=>{const at=attrs(cell.split('>')[0]+'>'),v=/<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];if(at.t==='s'){const head=cell.slice(0,cell.indexOf('>')+1).replace(/\bt="s"/,'t="inlineStr"');return head+'<is><t xml:space="preserve">'+escapeXml(strings[+v]||'')+'</t></is></c>';}return cell.replace(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/g,'');});
  // Keep the delivery-table layout, but no drawings, notes, external formulas or hidden source tabs.
  for(const t of ['hyperlinks','drawing','legacyDrawing','legacyDrawingHF','tableParts','extLst','conditionalFormatting','dataValidations','oleObjects','controls','picture'])clean=clean.replace(new RegExp('<'+t+'\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/'+t+'>)','g'),'');
  clean=clean.replace(/\s+r:id="[^"]*"/g,'').replace(/\s+codeName="[^"]*"/g,'');
  sheets.push({name:a.name,xml:clean});entries.push(...parsed);
 }
 if(!entries.length)throw Error('No scoped deliverables were found in '+source.name+'.');
 return {source,scopeId:context.id,mappingEvidence:context.mappingEvidence||null,entries,sheets,styles:xml('xl/styles.xml'),theme:xml('xl/theme/theme1.xml')};
}
export function mergeTidps(records){
 const grouped=new Map();for(const record of records)for(const raw of record.entries){const r={...raw,category:deliverableCategory(raw)};const key=r.scopeId+'|'+r.name.toUpperCase();if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
 const entries=[];let duplicates=0,conflicts=0,duplicateGroups=0;for(const [duplicateKey,variants] of grouped){
  const origins=variants.map(x=>({id:x.id,sourceId:x.sourceId,sourceName:x.sourceName,sourceVersion:x.sourceVersion,sourceUrl:x.sourceUrl,sheet:x.sheet,row:x.row})),conflictFields=[];
  for(const field of ['description','category','discipline','originator','plannedDate','forecastDate','approvalStatus','projectStage','latestIssueDate','revision','formats','exchanges']){
   if(new Set(variants.map(x=>JSON.stringify(x[field]))).size>1)conflictFields.push(field);
  }
  duplicates+=variants.length-1;duplicateGroups+=variants.length>1?1:0;conflicts+=conflictFields.length>0?1:0;
  // Row identity owns its values; repeated filenames never collapse deliverables.
  for(const r of variants)entries.push({...r,rowDeliverable:true,origins,duplicateKey,duplicateCount:variants.length-1,conflictFields,conflict:conflictFields.length>0});
 }
 return {entries,total:entries.length,duplicates,conflicts,duplicateGroups,affectedDocuments:entries.filter(r=>r.duplicateCount>0).length,countBasis:'tidp-row'};
}
export function exportTidps(records,entries,start,end){
 const ranged=!!(start||end);if(ranged)dateRange(start,end);
 const selected=entries.filter(r=>!ranged||inDateRange(r,start,end));
 if(!selected.length)throw Error('No deliverables match this export.');
 return exportConsolidated(records,selected);
}
