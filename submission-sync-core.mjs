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
// Builds the same payload the upload page sends to validateLog. asOf is the ACC version date, never later than today.
export function logFromSheets(sheets,{stage,source,asOf,mappings=[]}){
 const table=locateLogTable(sheets),rows=sheets[table.sheet].rows,order=logDateOrder(rows,table.header,table.map.date);
 // Review reports list a review's files under one ID / Created on row; blanks are filled within that review only.
 const mapped=mapLogRows(rows,table.header,table.map,order,true);
 if(!mapped.length)throw Error('The log has no document rows.');
 const day=text(asOf).slice(0,10),limit=today();
 return {stage,source,asOf:day&&day<=limit?day:limit,basis:'latest',rows:mapped,mappings,table:{sheet:table.sheetName,headerRow:table.header+1,dateOrder:order}};
}
