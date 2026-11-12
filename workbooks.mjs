import {read,utils} from 'xlsx';
import {downloadWorkbook} from './sources.mjs';
import {parseNamingRules} from './naming.mjs';
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
export function parseTrackerRows(rows,hiddenColumns=[]){
 const header=rows.findIndex(r=>r.some(c=>/^LOG\s*%$/i.test(text(c)))&&r.some(c=>/^LOI\s*%$/i.test(text(c))));
 if(header<0)throw Error('LOG and LOI columns were not found.');
 const h=rows[header].map(text),visible=re=>h.flatMap((c,i)=>re.test(c)&&!hiddenColumns.includes(i)?[i]:[]),logs=visible(/^LOG\s*%$/i),lois=visible(/^LOI\s*%$/i);
 if(logs.length!==1||lois.length!==1)throw Error('The tracker must have one visible LOG and LOI column.');
 const name=h.findIndex(c=>/^name$/i.test(c)),log=logs[0],loi=lois[0],desc=h.findIndex(c=>/^description$/i.test(c)),parcel=h.findIndex(c=>/^parcel$/i.test(c));
 if(name<0)throw Error('Tracker model name column was not found.');
 const result=[];let group='';
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i],n=text(r[name]);
  if(!/^M1-/i.test(n)){const nonempty=r.map(text).filter(Boolean);if(nonempty.length===1)group=nonempty[0];continue;}
  result.push({name:n,description:text(r[desc]),parcel:text(r[parcel]),group,log:percentage(r[log]),loi:percentage(r[loi]),row:i+1});
 }
 if(!result.length)throw Error('No model tracker rows found.');return result;
}
export function parseMidpRows(rows,sheet){
 const formats=rows.find(r=>r.some(c=>/^\.rvt$/i.test(text(c)))&&r.some(c=>/^\.dwg$/i.test(text(c))));
 if(!formats)return [];
 const modelColumns=formats.flatMap((c,i)=>/^\.(rvt|nwc|nwd|ifc|dwg)$/i.test(text(c))?[i]:[]);
 const result=[];let inModels=false,discipline='';
 for(let i=0;i<rows.length;i++){
  const r=rows[i],name=text(r[0]);
  if(/^DISCIPLINE:/i.test(name)){discipline=name.replace(/^DISCIPLINE:\s*/i,'');inModels=false;}
  if(/^BIM Models?$/i.test(name))inModels=true;
  if(/^DRAWINGS/i.test(name))inModels=false;
  if(inModels&&/^M1-/i.test(name)&&modelColumns.some(c=>/^yes$/i.test(text(r[c]))))result.push({name,description:text(r[1]),disciplineCode:discipline,folderPath:[sheet,discipline,text(r[1])],sheet,row:i+1});
 }
 return result;
}
export async function workbookSnapshot(env,key){const saved=await env.BUCKET.get('m1/workbooks/'+key);return saved?await saved.json():null;}
export async function syncWorkbook(env,key){
 if(!['tidp','tracker','midp'].includes(key))throw Error('Unknown workbook.');
 const data=await downloadWorkbook(env,key),title=key==='tidp'?'Asset Tagging Naming':'Tracker';
 if(key==='midp'){
  const names=read(data.bytes,{type:'array',bookSheets:true}).SheetNames.filter(n=>n!=='Index'&&n!=='YYY-ARX-BIM');
  if(names.length>80)throw Error('MIDP exceeds the sheet limit.');
  const rows=[];
  // One sheet at a time bounds memory on the free Worker plan.
  for(const name of names){const book=read(data.bytes,{type:'array',sheets:[name],cellText:false,cellFormula:false,cellHTML:false,cellStyles:false,sheetRows:10000});const sheet=book.Sheets[name];if(sheet['!fullref']&&utils.decode_range(sheet['!fullref']).e.r>=10000)throw Error('MIDP sheet exceeds the row limit.');rows.push(...parseMidpRows(utils.sheet_to_json(sheet,{header:1,defval:null}),name));}
  if(!rows.length)throw Error('No MIDP model requirements found.');
  const result={source:{...data.source,sheet:'Model sections; federation excluded'},rows};await env.BUCKET.put('m1/workbooks/midp',JSON.stringify(result));return result;
 }
 const book=read(data.bytes,{type:'array',sheets:key==='tidp'?[title,'Supporting Data']:[title],cellFormula:false,cellHTML:false,cellStyles:false,sheetRows:10000});
 const sheet=book.Sheets[title];if(!sheet)throw Error('Required workbook tab is missing.');
 // Read visibility separately: style parsing in the current tracker can suppress
 // cached model-name strings. Values must come from the unstyled read.
 const columns=key==='tracker'?read(data.bytes,{type:'array',sheets:[title],cellStyles:true,cellFormula:false,cellHTML:false,sheetRows:3}).Sheets[title]['!cols']:[];
 const raw=utils.sheet_to_json(sheet,{header:1,defval:null}),hidden=(columns||[]).flatMap((c,i)=>c?.hidden?[i]:[]),rows=key==='tidp'?parseAssetRows(raw):parseTrackerRows(raw,hidden);
 const result={source:{...data.source,sheet:title},rows};
 if(key==='tidp')result.naming=parseNamingRules(utils.sheet_to_json(book.Sheets['Supporting Data'],{header:1,defval:null}));
 await env.BUCKET.put('m1/workbooks/'+key,JSON.stringify(result));return result;
}
