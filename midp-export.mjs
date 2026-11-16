import layout from './company/hub/midp-layout.json' with {type:'json'};
import {zipSync,strToU8} from 'fflate';
import {issueDate} from './midp.mjs';

// A blank, sanitized copy of the approved layout. Source macros and paths are not shipped.
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc=v=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const dec=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
const elements=(s,t)=>[...s.matchAll(new RegExp('<'+t+'\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/'+t+'>)','g'))].map(m=>m[0]);
const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
const letter=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const serial=v=>{const d=issueDate(v);return d?(Date.parse(d)-Date.UTC(1899,11,30))/86400000:v;};
const dateCols=new Set([27,31,35,39,43,47,51,55,56]);
function cells(xml){const out=[];for(const c of elements(xml,'c')){const ref=/\br="([A-Z]+)\d+"/.exec(c)?.[1];if(!ref)continue;const v=/<v>([\s\S]*?)<\/v>/.exec(c)?.[1];out[col(ref)]=/\bt="(?:inlineStr|str|e)"/.test(c)?(v===undefined?elements(c,'t').map(t=>dec(t.replace(/^<t\b[^>]*>|<\/t>$/g,''))).join(''):dec(v)):v===undefined?'':Number(v);}return out;}
function sourceRows(sheet){const rows=new Map(elements(sheet.xml,'row').map(r=>[+(/\br="(\d+)"/.exec(r)?.[1]),cells(r)]));const header=[...rows.values()].find(r=>r.some(v=>norm(v)==='issue date'))||[];const formats=[...rows.values()].find(r=>r.some(v=>/^\.?rvt$/.test(norm(v))))||[];return {rows,header,formats};}
const targetHeaders=cells(layout.headerRows[5]);
const targetFormats=cells(layout.headerRows[6]);
export function consolidatedData(records,entries){
 const selected=new Map(entries.map(e=>[e.sourceId+'|'+e.sheet+'|'+e.row,e])),groups=new Map(),sources=[];
 for(const record of records){let used=false;for(const sheet of record.sheets){const {rows,header,formats}=sourceRows(sheet);const issues=header.flatMap((v,i)=>norm(v)==='issue date'?[i]:[]),ownerRow=[...rows.values()].find(r=>r.some(v=>norm(v)==='owner:'))||[],owners=issues.map(c=>ownerRow[c]||'');
  for(const [row,raw] of rows){const e=selected.get(record.source.itemId+'|'+sheet.name+'|'+row);if(!e)continue;used=true;
   const suffix=(record.source.name.split(/_TIDP_/i)[1]||'').replace(/\.xlsx?m?$/i,'').toLowerCase();
   const tab=(layout.assetTabs[suffix]||e.scopeId||e.scopeAsset).replace(/[\\/*?:\[\]]/g,'').slice(0,31);
   if(!groups.has(tab))groups.set(tab,[]);const v=Array(57).fill('');
   v[0]=e.name;v[1]=e.description;
   for(let i=2;i<13;i++){const f=norm(targetFormats[i]).replace(/^\./,'');const j=formats.findIndex(x=>norm(x).replace(/^\./,'')===f);if(j>=0)v[i]=raw[j]??'';}
   for(let i=13;i<26;i++){const j=header.findIndex(x=>norm(x)===norm(targetHeaders[i]));if(j>=0)v[i]=raw[j]??'';}
   for(let i=0;i<Math.min(7,issues.length);i++)for(let j=0;j<4;j++)v[26+i*4+j]=raw[issues[i]-1+j]??'';
   v[54]=e.approvalStatus||'';v[55]=e.plannedDate||'';v[56]=e.forecastDate||'';
   for(const i of dateCols)if(v[i]!==''&&v[i]!=null)v[i]=serial(v[i]);
   groups.get(tab).push({entry:e,values:v,tab,owners});
  }
 }if(used)sources.push(record.source);}
 const assets=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([tab,rows])=>({tab,rows}));
 if(assets.reduce((n,a)=>n+a.rows.length,0)!==entries.length)throw Error('TIDP export source is incomplete. Refresh and retry.');
 return {assets,sources};
}
function cell(v,c,r,style=layout.bodyStyle){return '<c r="'+letter(c)+r+'" s="'+style+'"'+(typeof v==='number'&&Number.isFinite(v)?'><v>'+v+'</v>':' t="inlineStr"><is><t xml:space="preserve">'+esc(v)+'</t></is>')+'</c>';}
function row(values,r,style=layout.bodyStyle,dates=false){return '<row r="'+r+'" ht="30" customHeight="1">'+values.map((v,c)=>cell(v,c,r,dates&&dateCols.has(c)&&typeof v==='number'?layout.dateStyle:style)).join('')+'</row>';}
const mergeXml=merges=>merges.length?'<mergeCells count="'+merges.length+'">'+merges.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells>':'';
function worksheet(rows,{cols='',merges=[],freeze=0,filter='',links=[]}={}){return '<worksheet xmlns="'+NS+'"><sheetViews><sheetView showGridLines="0" workbookViewId="0">'+(freeze?'<pane ySplit="'+freeze+'" topLeftCell="A'+(freeze+1)+'" activePane="bottomLeft" state="frozen"/>':'')+'</sheetView></sheetViews>'+cols+'<sheetData>'+rows+'</sheetData>'+(filter?'<autoFilter ref="'+filter+'"/>':'')+mergeXml(merges)+(links.length?'<hyperlinks>'+links.map(l=>'<hyperlink ref="'+l.ref+'" location="'+esc(l.location)+'" display="'+esc(l.label)+'"/>').join('')+'</hyperlinks>':'')+'<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="8" fitToWidth="1" fitToHeight="0"/></worksheet>';}
const simpleCols=(count,width=24)=>'<cols><col min="1" max="'+count+'" width="'+width+'" customWidth="1"/></cols>';
function assetSheet(asset){
 let rows=layout.headerRows.join('').replace('{{ASSET}}',esc(asset.tab));
 for(let i=0;i<7;i++){const c=27+i*4,ref=letter(c)+'4',owners=[...new Set(asset.rows.map(r=>r.owners[i]).filter(Boolean))].join(', ');rows=rows.replace(new RegExp('<c\\b[^>]*\\br="'+ref+'"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)'),cell(owners,c,4,32));}
 rows=rows.replace(/(<row\b[^>]*\br="6"[^>]*>)([\s\S]*?)(<\/row>)/,(_,a,b,c)=>a+b+['MACE_ACC_Status','Planned Date','Forecast Date'].map((v,i)=>cell(v,54+i,6,32)).join('')+c);
 const merges=[...layout.merges,'BC6:BC7','BD6:BD7','BE6:BE7'];let n=8;
 const disciplines=new Map();for(const item of asset.rows){const d=item.entry.discipline||item.entry.sheet;if(!disciplines.has(d))disciplines.set(d,[]);disciplines.get(d).push(item);}
 for(const [disc,items] of disciplines){rows+=row(['DISCIPLINE: '+disc],n,32);merges.push('A'+n+':BE'+n);n++;let category=null;
  for(const item of items){if(item.entry.category!==category){category=item.entry.category;rows+=row([category||'Deliverables'],n,34);merges.push('A'+n+':BE'+n);n++;}rows+=row(item.values,n++,layout.bodyStyle,true);}
 }
 const cols=layout.columns.replace('</cols>','<col min="55" max="57" width="20" customWidth="1"/></cols>');
 return worksheet(rows,{cols,merges,freeze:7}).replace('ySplit="7" topLeftCell="A8" activePane="bottomLeft"','xSplit="2" ySplit="7" topLeftCell="C8" activePane="bottomRight"');
}
function summarySheet(assets){
 let n=1,rows='',merges=[],links=[];const add=(v,style=layout.bodyStyle)=>{rows+=row(v,n++,style);};
 add(['MIDP Summary - drawings per asset and discipline'],32);merges.push('A1:S1');
 add(['Counts drawing deliverable rows (DWG document type) in this export. Every TIDP row is retained, including repeated numbers.']);merges.push('A2:S2');n++;
 const included=new Set(assets.map(a=>a.tab)),known=new Set(layout.summaryGroups.flatMap(g=>g.assets));
 const groups=[...layout.summaryGroups,{title:'OTHER SCOPED ASSETS',assets:assets.map(a=>a.tab).filter(t=>!known.has(t)),disciplines:[...new Set(assets.flatMap(a=>a.rows.map(r=>r.entry.discipline||r.entry.sheet)))].sort()}];
 let grand=0;
 for(const g of groups){const names=g.assets.filter(a=>included.has(a));if(!names.length)continue;add([g.title+' ('+names.length+')'],32);merges.push('A'+(n-1)+':'+letter(g.disciplines.length+2)+(n-1));add(['Asset',...g.disciplines,'Other','Total'],34);const totals=Array(g.disciplines.length+1).fill(0);
  for(const name of names){const items=assets.find(a=>a.tab===name).rows.filter(r=>String(r.values[20]||r.entry.name.split('-')[6]).toUpperCase()==='DWG'),counts=Array(totals.length).fill(0);
   for(const item of items){const i=g.disciplines.indexOf(item.entry.discipline||item.entry.sheet);counts[i<0?counts.length-1:i]++;}counts.forEach((v,i)=>totals[i]+=v);links.push({ref:'A'+n,location:"'"+name.replaceAll("'","''")+"'!A1",label:name});add([name,...counts,items.length]);
  }const total=totals.reduce((a,b)=>a+b,0);grand+=total;add(['Total',...totals,total],34);n+=2;
 }add(['Grand total (all drawing schedules)',grand],32);add(['All exported deliverables',assets.reduce((n,a)=>n+a.rows.length,0)]);
 return worksheet(rows,{cols:'<cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="30" width="11" customWidth="1"/></cols>',merges,links});
}
export function exportConsolidated(records,entries){
 const {assets,sources}=consolidatedData(records,entries),sheets=[];
 sheets.push({name:'Summary',xml:summarySheet(assets)});
 const indexHeaders=['No.','Asset Worksheet Tab','Disciplines Count','Disciplines Included','Total Deliverables','Original Source File Name','Status','Source Modified'];
 let index=row(['MIDP MASTER REGISTER - CONSOLIDATED MIDP REGISTER'],1,32)+row(['Master Information Delivery Plans (MIDP) Consolidated by Asset and Discipline'],2)+row(['Total Assets: '+assets.length+' | Total Deliverables: '+entries.length],3)+row(indexHeaders,5,34);
 const links=[];assets.forEach((a,i)=>{const ds=[...new Set(a.rows.map(r=>r.entry.discipline||r.entry.sheet))],src=sources.filter(s=>a.rows.some(r=>r.entry.sourceId===s.itemId));index+=row([i+1,a.tab,ds.length,ds.join(', '),a.rows.length,src.map(s=>s.name).join('\n'),a.rows.some(r=>r.entry.duplicateCount)?'Repeated numbers':'OK',src.map(s=>s.updatedAt||'').join('\n')],i+6);links.push({ref:'B'+(i+6),location:"'"+a.tab.replaceAll("'","''")+"'!A1",label:a.tab});});
 sheets.push({name:'Index',hidden:true,xml:worksheet(index,{cols:simpleCols(8,30),merges:['A1:H1','A2:H2','A3:H3'],freeze:5,links})});
 let data=row([...Array.from({length:57},(_,i)=>'c'+String(i+1).padStart(2,'0')),'Disc','Asset'],1,34),n=2;
 for(const a of assets)for(const r of a.rows)data+=row([...r.values,r.entry.discipline||r.entry.sheet,a.tab],n++,layout.bodyStyle,true);
 sheets.push({name:'Data',hidden:true,xml:worksheet(data,{filter:'A1:BG'+(n-1),freeze:1})});
 const settings=[['Source','Current scoped ACC TIDPs'],['Layout',layout.reference],['Exported at',new Date().toISOString()],['Export refresh','Use Refresh in the M1 dashboard, then export again.'],['Counting','One source TIDP row is one deliverable.'],['Source file','Asset tab'],...assets.flatMap(a=>sources.filter(s=>a.rows.some(r=>r.entry.sourceId===s.itemId)).map(s=>[s.name,a.tab]))];
 sheets.push({name:'Settings',xml:worksheet(settings.map((v,i)=>row(v,i+1,i===5?34:layout.bodyStyle)).join(''),{cols:simpleCols(2,70)})});
 for(const a of assets)sheets.push({name:a.tab,xml:assetSheet(a)});
 const audit=[['Source TIDP','ACC version','Last modified','ACC link','Source sheet','Source row','Asset tab','Deliverable'],...assets.flatMap(a=>a.rows.map(r=>[r.entry.sourceName,r.entry.sourceVersion,sources.find(s=>s.itemId===r.entry.sourceId)?.updatedAt||'',r.entry.sourceUrl,r.entry.sheet,r.entry.row,a.tab,r.entry.name]))];
 sheets.push({name:'TIDP sources',xml:worksheet(audit.map((v,i)=>row(v,i+1,i?layout.bodyStyle:34)).join(''),{cols:simpleCols(8,36),freeze:1,filter:'A1:H'+audit.length})});
 const parts={'xl/styles.xml':layout.styles,'xl/theme/theme1.xml':layout.theme};
 sheets.forEach((s,i)=>parts['xl/worksheets/sheet'+(i+1)+'.xml']=s.xml);
 parts['xl/workbook.xml']='<workbook xmlns="'+NS+'" xmlns:r="'+REL+'"><bookViews><workbookView/></bookViews><sheets>'+sheets.map((s,i)=>'<sheet name="'+esc(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"'+(s.hidden?' state="hidden"':'')+'/>').join('')+'</sheets></workbook>';
 parts['xl/_rels/workbook.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="styles" Type="'+REL+'/styles" Target="styles.xml"/><Relationship Id="theme" Type="'+REL+'/theme" Target="theme/theme1.xml"/></Relationships>';
 parts['_rels/.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
 parts['[Content_Types].xml']='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>';
 return {bytes:zipSync(Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,strToU8(v)])),{level:1}),count:entries.length};
}
