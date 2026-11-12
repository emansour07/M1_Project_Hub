import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
const text=v=>String(v??'').trim();
export const MIDP_URL='https://acc.autodesk.eu/docs/files/projects/e80ed581-2f73-4b70-a8d1-f100b9b95f4d?folderUrn=urn%3Aadsk.wipemea%3Afs.folder%3Aco.2yq8fVilSXijk7ixwBZdrg&entityId=urn%3Aadsk.wipemea%3Adm.lineage%3AKx4epOWERrSmEs2pLoS5SA&viewModel=detail&moduleId=folders';
export function issueDate(value,date1904=false){
 if(value===null||value===undefined||!text(value))return null;
 if(typeof value==='number'){if(!Number.isFinite(value)||value<1||value>100000)return null;return new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+Math.floor(value)*86400000).toISOString().slice(0,10);}
 const s=text(value);let m=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s),y,month,day;
 if(m){[,y,month,day]=m;}else if(m=/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s)){[,day,month,y]=m;}else return null;
 const d=new Date(Date.UTC(+y,+month-1,+day));return d.getUTCFullYear()===+y&&d.getUTCMonth()===+month-1&&d.getUTCDate()===+day?d.toISOString().slice(0,10):null;
}
export function parseMidpDeliverables(rows,sheet,date1904=false){
 const header=rows.findIndex(r=>r.some(v=>/^Issue Date$/i.test(text(v))));if(header<0)return [];
 const columns=rows[header].flatMap((v,i)=>/^Issue Date$/i.test(text(v))?[i]:[]),formats=rows.slice(0,header+3).find(r=>r.some(v=>/^\.rvt$/i.test(text(v))))||[];
 let discipline='';const entries=[];
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i],name=text(r[0]);if(/^DISCIPLINE:/i.test(name))discipline=name.replace(/^DISCIPLINE:\s*/i,'');if(!/^M1-/i.test(name))continue;
  const exchanges=columns.flatMap((column,index)=>{const date=issueDate(r[column],date1904);return date?[{exchange:index+1,date,revision:text(r[column-1]),author:text(r[column+1]),transmittal:text(r[column+2])}]:[];});
  const latest=[...exchanges].sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
  entries.push({id:sheet+'!'+(i+1),sheet,row:i+1,name,description:text(r[1]),discipline,asset:text(r[17])||name.split('-')[3],originator:text(r[16])||name.split('-')[2],formats:formats.flatMap((v,c)=>/^\./.test(text(v))&&/^yes$/i.test(text(r[c]))?[text(v)]:[]),latestIssueDate:latest?.date||null,latestExchange:latest?.exchange||null,revision:latest?.revision||null,exchanges,invalidDateCells:columns.filter(c=>text(r[c])&&!issueDate(r[c],date1904)).length});
 }
 return entries;
}
export function dateRange(start,end){if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||'')||issueDate(start)!==start||issueDate(end)!==end||start>end)throw Error('Choose a valid start and end date.');return {start,end};}
export const inDateRange=(row,start,end)=>!!row.latestIssueDate&&row.latestIssueDate>=start&&row.latestIssueDate<=end;
const decode=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
export function filterMidpWorkbook(bytes,entries,start,end){
 dateRange(start,end);const selected=entries.filter(r=>inDateRange(r,start,end));if(!selected.length)throw Error('No MIDP entries have a latest issue date in this range.');
 let total=0;const parts=unzipSync(bytes,{filter(file){total+=file.originalSize;if(total>60000000||file.originalSize>10000000)throw Error('Workbook exceeds the export size limit.');return true;}});
 let workbook=strFromU8(parts['xl/workbook.xml']),rels=strFromU8(parts['xl/_rels/workbook.xml.rels']);
 const targets=new Map([...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m=>{const a=attrs(m[0]);return [a.Id,a.Target];}));
 const sheets=[...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(m=>attrs(m[0])),keep=new Set(selected.map(r=>r.sheet)),removeIds=new Set(),removedParts=new Set(),usedStrings=new Set();
 const strings=parts['xl/sharedStrings.xml']?[...strFromU8(parts['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>[\s\S]*?<\/si>/g)].map(m=>m[0]):[];
 const value=cell=>{const v=/<v>([\s\S]*?)<\/v>/.exec(cell)?.[1]||'';return /\bt="s"/.test(cell)?decode((strings[+v]||'').replace(/<[^>]+>/g,'')):decode(v||cell.replace(/<[^>]+>/g,''));};
 for(const sheet of sheets){let target=targets.get(sheet['r:id']);if(!target)throw Error('Workbook sheet relationship is missing.');target=target.startsWith('/')?target.slice(1):'xl/'+target;if(target.includes('..')||!parts[target])throw Error('Invalid workbook sheet path.');
  if(!keep.has(sheet.name)){removedParts.add(target);delete parts[target];const slash=target.lastIndexOf('/'),rel=target.slice(0,slash)+'/_rels/'+target.slice(slash+1)+'.rels';delete parts[rel];removeIds.add(sheet['r:id']);continue;}
  const wanted=new Set(selected.filter(r=>r.sheet===sheet.name).map(r=>r.row));let found=0;
  let xml=strFromU8(parts[target]).replace(/<row\b[^>]*>[\s\S]*?<\/row>/g,row=>{const a=attrs(row.slice(0,row.indexOf('>')+1)),n=+a.r;if(wanted.has(n)){found++;return row.replace(/^<row([^>]*)>/,(_m,at)=>'<row'+at.replace(/\s+hidden="[^"]*"/g,'')+'>');}
   const first=/<c\b[^>]*\br="A\d+"[^>]*>[\s\S]*?<\/c>/.exec(row)?.[0];
   if(first&&/^M1-/i.test(value(first)))return '<row r="'+n+'" hidden="1"/>';
   return row;
  });if(found!==wanted.size)throw Error('MIDP rows changed. Refresh and try again.');
  // Remove unused row-level notes and links as these can reference excluded items.
  xml=xml.replace(/<hyperlinks\b[^>]*>[\s\S]*?<\/hyperlinks>/g,'').replace(/<legacyDrawing\b[^>]*\/>/g,'');
  for(const m of xml.matchAll(/<c\b[^>]*\bt="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>/g))usedStrings.add(+m[1]);
  parts[target]=strToU8(xml);
 }
 workbook=workbook.replace(/<sheet\b[^>]*\/>/g,tag=>removeIds.has(attrs(tag)['r:id'])?'':tag).replace(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/g,'').replace(/<externalReferences\b[^>]*>[\s\S]*?<\/externalReferences>/g,'').replace(/activeTab="\d+"/g,'activeTab="0"');
 rels=rels.replace(/<Relationship\b[^>]*\/>/g,tag=>removeIds.has(attrs(tag).Id)||/externalLink|calcChain/.test(tag)?'':tag);
 parts['xl/workbook.xml']=strToU8(workbook);parts['xl/_rels/workbook.xml.rels']=strToU8(rels);
 if(strings.length)parts['xl/sharedStrings.xml']=strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="'+strings.length+'">'+strings.map((s,i)=>usedStrings.has(i)?s:'<si><t></t></si>').join('')+'</sst>');
 for(const key of Object.keys(parts))if(/^xl\/(externalLinks|comments|threadedComments|persons)\//.test(key)||/^xl\/comments\d+\.xml$/.test(key)||key==='xl/calcChain.xml'){removedParts.add(key);delete parts[key];}
 // Comments/external links must not retain excluded data through relationships.
 for(const key of Object.keys(parts))if(key.endsWith('.rels'))parts[key]=strToU8(strFromU8(parts[key]).replace(/<Relationship\b[^>]*\/>/g,tag=>/comments|threadedComment|person|externalLink/.test(tag)?'':tag));
 if(parts['[Content_Types].xml'])parts['[Content_Types].xml']=strToU8(strFromU8(parts['[Content_Types].xml']).replace(/<Override\b[^>]*\/>/g,tag=>removedParts.has((attrs(tag).PartName||'').replace(/^\//,''))?'':tag));
 // Workbook metadata may list every original asset sheet. It is optional.
 if(parts['docProps/app.xml'])parts['docProps/app.xml']=strToU8('<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
 return {bytes:zipSync(parts,{level:1}),count:selected.length};
}
