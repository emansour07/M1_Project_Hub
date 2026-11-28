// Automatic reading of the two submission logs kept in ACC. Pure rules only: no network, no storage.
// The same column, date and matching rules as the owner upload page apply; nothing is guessed beyond them.
import {suggestColumns,mapLogRows,today} from './submissions-core.mjs';
const text=v=>String(v??'').trim();
// One fixed workbook per stage in the Submission_Logs folder. ACC keeps earlier uploads as versions of the same file.
export const LOG_FILES={arxSapac:/^M1-ARX-SAP-Review[_ ]Report\.xlsx$/i,sapacMace:/^M1-SAP-MAC-Review[_ ]Report\.xlsx$/i};
export const LOG_FILE_NAMES={arxSapac:'M1-ARX-SAP-Review_Report.xlsx',sapacMace:'M1-SAP-MAC-Review_Report.xlsx'};
export function logStage(name){const n=text(name);if(n.startsWith('~$'))return null;return Object.keys(LOG_FILES).find(stage=>LOG_FILES[stage].test(n))||null;}
// Exactly one workbook may claim a stage. Two candidates are reported, never chosen between.
export function pickLogFiles(items){
 const out={};for(const stage of Object.keys(LOG_FILES)){const found=(items||[]).filter(i=>logStage(i.name)===stage);out[stage]=found.length===1?{file:found[0]}:{error:found.length?'More than one '+LOG_FILE_NAMES[stage]+' is in the folder. Keep one.':LOG_FILE_NAMES[stage]+' is not in the Submission_Logs folder.'};}
 return out;
}
const score=row=>{const m=suggestColumns(row);return {map:m,key:(m.name>=0?10:0)+(m.date>=0?10:0),all:(m.name>=0?10:0)+(m.date>=0?10:0)+Object.values(m).filter(x=>x>=0).length};};
// The upload page's choice, made without the owner: the sheet and header row that best fit the known column names.
export function locateLogTable(sheets){
 let sheet=-1,best=0;(sheets||[]).forEach((s,i)=>{const n=Math.max(0,...s.rows.slice(0,50).map(r=>score(r).key));if(n>best){sheet=i;best=n;}});
 if(sheet<0)throw Error('No sheet has a document column and a submission-date column.');
 let header=0,top=0;sheets[sheet].rows.slice(0,50).forEach((r,i)=>{const n=score(r).all;if(n>top){header=i;top=n;}});
 // Name the headings found, so an unfamiliar log layout can be recognised without opening the file.
 const map=score(sheets[sheet].rows[header]).map;if(!(map.name>=0||map.title>=0)||!(map.date>=0))throw Error('The log needs a File name (or Document number) column and a Created on (or Submission date) column. Sheet "'+text(sheets[sheet].name).slice(0,40)+'", row '+(header+1)+' has: '+(sheets[sheet].rows[header].map(text).filter(Boolean).slice(0,20).map(h=>h.slice(0,40)).join(' | ')||'no headings')+'.');
 return {sheet,sheetName:sheets[sheet].name,header,map};
}
// Numeric dates such as 04/05/2026 are only read when the log itself proves the order (a day above 12 somewhere).
export function logDateOrder(rows,header,column){
 let dmy=false,mdy=false,numeric=false;for(const r of rows.slice(header+1)){const m=/^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{4}(?:\s.*)?$/.exec(text(r[column]));if(!m)continue;numeric=true;if(+m[1]>12)dmy=true;if(+m[2]>12)mdy=true;}
 if(!numeric)return 'ISO';if(dmy&&mdy)throw Error('The date column mixes day/month and month/day dates.');if(!dmy&&!mdy)throw Error('The date order cannot be confirmed from this log. Upload it on the owner page and choose day/month or month/day.');return dmy?'DMY':'MDY';
}
// MACE's document register (the SAPAC–MACE workbook): one sheet per document category, the drawing number inside
// "Item Description", and one group of columns per revision (Date, WF No., Response, Code). Each dated revision is one round.
const REVISION=/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+revision$/i;
// MACE review codes as used in the register. An unlisted code is carried through as written, never interpreted.
export const REGISTER_CODES={A:'Approved',B:'Approved w/ comments',C:'Revise and resubmit',D:'Rejected',UR:'Under review'};
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function registerDay(value){
 const s=text(value);if(!s)return null;let y,mo,d,m=/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
 if(m)[,y,mo,d]=m;else if(m=/^(\d{1,2})[\/\s.\-]([A-Za-z]{3,9})[\/\s.\-](\d{2}|\d{4})$/.exec(s)){d=m[1];mo=MONTHS.indexOf(m[2].slice(0,3).toLowerCase())+1;y=m[3].length===2?'20'+m[3]:m[3];}else return undefined;
 const out=[y,String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('-');return Number.isFinite(Date.parse(out))&&new Date(out).toISOString().slice(0,10)===out?out:undefined;
}
export function registerTable(rows){
 for(let h=0;h<Math.min(rows.length-1,25);h++){const head=rows[h].map(text),desc=head.findIndex(x=>/^item description$/i.test(x)),starts=head.map((x,i)=>REVISION.test(x)?i:-1).filter(i=>i>=0);if(desc<0||!starts.length)continue;
  const sub=rows[h+1].map(text),width=Math.max(head.length,sub.length),revisions=starts.map((start,n)=>{const end=starts[n+1]??width,find=re=>{for(let c=start;c<end;c++)if(re.test(sub[c]||''))return c;return -1;};return {label:head[start],date:find(/^date$/i),reference:find(/^wf\.?\s*no\.?$/i),code:find(/^code$/i)};}).filter(r=>r.date>=0);
  if(revisions.length)return {header:h,desc,doc:head.findIndex(x=>/^document (?:number|no\.?)$/i.test(x)),revisions};}
 return null;
}
// Every register sheet is read; sheets without the register layout (for example the statistics sheet) are left out.
export function registerRows(sheets){
 const rows=[],used=[];let undated=0;
 for(const sheet of sheets||[]){const t=registerTable(sheet.rows);if(!t)continue;used.push(sheet.name);
  for(let i=t.header+2;i<sheet.rows.length;i++){const r=sheet.rows[i],description=text(r[t.desc]).slice(0,500),number=t.doc>=0?text(r[t.doc]).slice(0,500):'',name=number||description;if(!name)continue;
   for(const rev of t.revisions){const day=registerDay(r[rev.date]);if(day===undefined){undated++;continue;}if(!day)continue;const code=rev.code>=0?text(r[rev.code]).toUpperCase():'';
    rows.push({name,title:number?description:'',date:day,reference:rev.reference>=0?text(r[rev.reference]):'',revision:rev.label,status:REGISTER_CODES[code]||(code?'Code '+code.slice(0,20):''),workflowStatus:'',sourceRow:i+1});}}}
 return used.length?{rows,sheets:used,undated}:null;
}
// Builds the same payload the upload page sends to validateLog. asOf is the ACC version date, never later than today.
export function logFromSheets(sheets,{stage,source,asOf,mappings=[]}){
 const day=text(asOf).slice(0,10),limit=today(),logDate=day&&day<=limit?day:limit,register=registerRows(sheets);
 if(register){if(!register.rows.length)throw Error('The register has no dated revisions yet.');return {stage,source,asOf:logDate,basis:'latest',rows:register.rows,mappings,table:{sheet:register.sheets.join(', ').slice(0,200),headerRow:null,dateOrder:'register',undated:register.undated}};}
 const table=locateLogTable(sheets),rows=sheets[table.sheet].rows,order=logDateOrder(rows,table.header,table.map.date);
 // Review reports list a review's files under one ID / Created on row; blanks are filled within that review only.
 const mapped=mapLogRows(rows,table.header,table.map,order,true);
 if(!mapped.length)throw Error('The log has no document rows.');
 return {stage,source,asOf:logDate,basis:'latest',rows:mapped,mappings,table:{sheet:table.sheetName,headerRow:table.header+1,dateOrder:order}};
}
