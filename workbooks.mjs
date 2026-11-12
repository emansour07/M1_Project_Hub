import {read,utils} from 'xlsx';
import {downloadWorkbook} from './sources.mjs';
const text=v=>String(v??'').trim();
export function parseAssetRows(rows){
 const header=rows.findIndex(r=>r.some(c=>/proposed/i.test(text(c)))&&r.some(c=>/section|existing/i.test(text(c))));
 if(header<0)throw Error('Asset Tagging Naming columns were not found.');
 const h=rows[header],old=h.findIndex(c=>/section|existing/i.test(text(c))),next=h.findIndex(c=>/proposed/i.test(text(c)));
 if(old<0||next!==old+2)throw Error('The asset mapping layout has changed.');
 const result=[],seen=new Set();let section='';
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i],name=text(r[old+1]),existing=text(r[old]).toUpperCase(),proposed=text(r[next]).toUpperCase();
  if(!proposed&&/^\d+(\.\d+)*$/.test(name)){section=name;continue;}
  if(!proposed||!name)continue;
  if(!/^[A-Z0-9]{2,8}$/.test(proposed))continue;
  const item={section,existing:existing||null,proposed,name,row:i+1};
  const key=[section,existing,proposed,name].join('|');if(!seen.has(key)){seen.add(key);result.push(item);}
 }
 if(!result.length)throw Error('No asset mappings found.');return result;
}
export function percentage(value){
 if(value===null||value===undefined||text(value)===''||/^#/.test(text(value)))return null;
 const s=text(value),n=typeof value==='number'?value:Number(s.replace('%',''));
 if(!Number.isFinite(n)||n<0)return null;
 const result=s.includes('%')?n:n<=1?n*100:n;
 return result<=100?Math.round(result*10)/10:null;
}
export function parseTrackerRows(rows){
 const header=rows.findIndex(r=>r.some(c=>/^LOG\s*%$/i.test(text(c)))&&r.some(c=>/^LOI\s*%$/i.test(text(c))));
 if(header<0)throw Error('LOG and LOI columns were not found.');
 const h=rows[header].map(text),name=h.findIndex(c=>/^name$/i.test(c)),log=h.findIndex(c=>/^LOG\s*%$/i.test(c)),loi=h.findIndex(c=>/^LOI\s*%$/i.test(c)),desc=h.findIndex(c=>/^description$/i.test(c)),parcel=h.findIndex(c=>/^parcel$/i.test(c));
 if(name<0)throw Error('Tracker model name column was not found.');
 const result=[];let group='';
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i],n=text(r[name]);
  if(!/^M1-/i.test(n)){const nonempty=r.map(text).filter(Boolean);if(nonempty.length===1)group=nonempty[0];continue;}
  result.push({name:n,description:text(r[desc]),parcel:text(r[parcel]),group,log:percentage(r[log]),loi:percentage(r[loi]),row:i+1});
 }
 if(!result.length)throw Error('No model tracker rows found.');return result;
}
export async function workbookSnapshot(env,key){const saved=await env.BUCKET.get('m1/workbooks/'+key);return saved?await saved.json():null;}
export async function syncWorkbook(env,key){
 if(!['tidp','tracker'].includes(key))throw Error('Unknown workbook.');
 const data=await downloadWorkbook(env,key),title=key==='tidp'?'Asset Tagging Naming':'Tracker';
 const book=read(data.bytes,{type:'array',sheets:[title],cellFormula:false,cellHTML:false,cellStyles:false,sheetRows:10000});
 const sheet=book.Sheets[title];if(!sheet)throw Error('Required workbook tab is missing.');
 const raw=utils.sheet_to_json(sheet,{header:1,defval:null}),rows=key==='tidp'?parseAssetRows(raw):parseTrackerRows(raw);
 const result={source:{...data.source,sheet:title},rows};
 await env.BUCKET.put('m1/workbooks/'+key,JSON.stringify(result));return result;
}
