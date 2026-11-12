import {leadColumns} from './tracker-fields.mjs';
import {filterDeliverables} from './delivery-core.mjs';
import {read,utils} from 'xlsx';
import {downloadWorkbook} from './sources.mjs';
import {parseNamingRules} from './naming.mjs';
import {parseScope,scopePolicy,scopedMapping,scopedFile,getScope} from './scope.mjs';
import {parseMidpDeliverables,filterMidpWorkbook,dateRange} from './midp.mjs';
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
export function trackerColumns(rows,hiddenColumns=[]){
 const header=rows.findIndex(r=>r.some(c=>/^LOG\s*%$/i.test(text(c)))&&r.some(c=>/^LOI\s*%$/i.test(text(c))));if(header<0)throw Error('Tracker headers were not found.');let group='';return rows[header].flatMap((v,i)=>{if(!text(v))return [];const heading=text(rows[header-1]?.[i]);if(heading)group=heading;else if(!/^(LOD|Team)/i.test(group))group='';return [{key:leadColumns.find(c=>c.label===text(v))?.key||utils.encode_col(i),excelColumn:utils.encode_col(i),label:text(v),group,hidden:hiddenColumns.includes(i),index:i,type:leadColumns.find(c=>c.label===text(v))?.type||(/date/i.test(text(v))?'date':/^(LOG|LOI)\s*%$/i.test(text(v))?'percent':'text'),readonly:leadColumns.find(c=>c.label===text(v))?.readonly||false}];});
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
  result.push({fields:Object.fromEntries(trackerColumns(rows,hiddenColumns).map(c=>[c.key,r[c.index]??null])),name:n,description:text(r[desc]),parcel:text(r[parcel]),group,log:percentage(r[log]),loi:percentage(r[loi]),row:i+1});
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
export function extractMidp(bytes){
 const names=read(bytes,{type:'array',bookSheets:true}).SheetNames.filter(n=>n!=='Index');if(names.length>80)throw Error('MIDP exceeds the sheet limit.');
 const rows=[],deliverables=[];
 for(const name of names){const book=read(bytes,{type:'array',sheets:[name],cellText:false,cellFormula:false,cellHTML:false,cellStyles:false,sheetRows:10000}),sheet=book.Sheets[name];if(sheet['!fullref']&&utils.decode_range(sheet['!fullref']).e.r>=10000)throw Error('MIDP sheet exceeds the row limit.');const raw=utils.sheet_to_json(sheet,{header:1,defval:null});if(name!=='YYY-ARX-BIM')rows.push(...parseMidpRows(raw,name));deliverables.push(...parseMidpDeliverables(raw,name,!!book.Workbook?.WBProps?.date1904));}
 if(!rows.length||!deliverables.length)throw Error('No MIDP deliverables found.');return {rows,deliverables};
}
async function saveLedger(env,source,entries){
 const scope=await getScope(env);if(!scope)throw Error('Read the scope register first.');entries=entries.map(r=>scopedFile(r,scope)).filter(Boolean);
 const generation=String(source.version)+'-'+crypto.randomUUID(),count=Math.ceil(entries.length/500);
 for(let i=0;i<count;i++)await env.BUCKET.put('m1/midp/'+generation+'/'+i,JSON.stringify(entries.slice(i*500,(i+1)*500)));
 const meta={source,generation,chunks:count,total:entries.length,dated:entries.filter(r=>r.latestIssueDate).length,scopeVersion:scope.revision,parserVersion:2};await env.BUCKET.put('m1/midp/latest',JSON.stringify(meta));if(env.SQL)env.SQL.exec("DELETE FROM objects WHERE key LIKE 'm1/midp/%' AND key<>? AND key<>'m1/midp/refresh-lock' AND key NOT LIKE ?",'m1/midp/latest','m1/midp/'+generation+'/%');return meta;
}
export async function midpSnapshot(env){const meta=await (await env.BUCKET.get('m1/midp/latest'))?.json();if(!meta)return null;const entries=[];for(let i=0;i<meta.chunks;i++){const chunk=await env.BUCKET.get('m1/midp/'+meta.generation+'/'+i);if(!chunk)throw Error('MIDP cache is incomplete.');entries.push(...await chunk.json());}const scope=await getScope(env),kept=entries.map(r=>scopedFile(r,scope)).filter(Boolean);return {source:meta.source,total:kept.length,dated:kept.filter(r=>r.latestIssueDate).length,entries:kept};}
export async function exportMidp(env,start,end,filters={}){
 dateRange(start,end);const data=await downloadWorkbook(env,'midp');let saved=await midpSnapshot(env);
 if(!saved||saved.source.version!==data.source.version){const parsed=extractMidp(data.bytes);await saveLedger(env,data.source,parsed.deliverables);saved=await midpSnapshot(env);}
 const result=filterMidpWorkbook(data.bytes,filterDeliverables(saved.entries,filters),start,end);return {...result,source:data.source};
}
export async function syncWorkbook(env,key){
 if(!['tidp','tracker','midp','scope'].includes(key))throw Error('Unknown workbook.');
 const data=await downloadWorkbook(env,key),title=key==='tidp'?'Asset Tagging Naming':'Tracker';
 if(key==='scope'){
  const book=read(data.bytes,{type:'array',sheets:['Scope mapping'],cellStyles:false,cellFormula:false,sheetRows:1000}),sheet=book.Sheets['Scope mapping'];if(!sheet)throw Error('Scope mapping tab is missing.');
  const rows=parseScope(utils.sheet_to_json(sheet,{header:1,defval:null})),result={source:data.source,rows};await env.BUCKET.put('m1/workbooks/scope',JSON.stringify(result));return result;
 }
 const scope=await getScope(env);if(key!=='tidp'&&!scope)throw Error('Read the scope register and naming table first.');
 if(key==='midp'){
  const prior=await(await env.BUCKET.get('m1/midp/latest'))?.json();if(prior?.parserVersion===2&&prior?.source.version===data.source.version&&prior.scopeVersion===scope.revision){const baseline=await workbookSnapshot(env,'midp');if(baseline){prior.source=data.source;await env.BUCKET.put('m1/midp/latest',JSON.stringify(prior));baseline.source.checkedAt=data.source.checkedAt;await env.BUCKET.put('m1/workbooks/midp',JSON.stringify(baseline));return baseline;}}
  const {rows,deliverables}=extractMidp(data.bytes);await saveLedger(env,data.source,deliverables);
  const result={source:{...data.source,sheet:'Model sections; federation excluded'},rows:rows.map(r=>scopedFile(r,scope)).filter(Boolean)};await env.BUCKET.put('m1/workbooks/midp',JSON.stringify(result));return result;
 }
 const deliverySheets=['ARCH','EWK','STR','MECH','ELE','PLU','FFI','ELV'];
 const book=read(data.bytes,{type:'array',sheets:key==='tidp'?[title,'Supporting Data',...deliverySheets]:[title],cellFormula:key==='tracker',cellHTML:false,cellStyles:false,sheetRows:10000});
 const sheet=book.Sheets[title];if(!sheet)throw Error('Required workbook tab is missing.');
 // Read visibility separately: style parsing in the current tracker can suppress
 // cached model-name strings. Values must come from the unstyled read.
 const columns=key==='tracker'?read(data.bytes,{type:'array',sheets:[title],cellStyles:true,cellFormula:false,cellHTML:false,sheetRows:3}).Sheets[title]['!cols']:[];
 const raw=utils.sheet_to_json(sheet,{header:1,defval:null}),hidden=(columns||[]).flatMap((c,i)=>c?.hidden?[i]:[]),rows=key==='tidp'?parseAssetRows(raw):parseTrackerRows(raw,hidden);
 const result={source:{...data.source,sheet:title},rows:rows.map(r=>key==='tidp'?r:scopedFile(r,scope)).filter(Boolean)};
 if(key==='tracker'){result.columns=trackerColumns(raw,hidden);result.date1904=!!book.Workbook?.WBProps?.date1904;for(const r of result.rows)r.formulaFields=result.columns.filter(c=>sheet[c.excelColumn+r.row]?.f).map(c=>c.key);}
 if(key==='tidp'){
  const scopeSource=await workbookSnapshot(env,'scope');if(!scopeSource)throw Error('Read the scope register first.');
  const policy={...scopePolicy(scopeSource.rows,rows),source:scopeSource.source};policy.revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(policy.rows))))).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16);await env.BUCKET.put('m1/scope',JSON.stringify(policy));result.rows=scopedMapping(policy);
  result.naming=parseNamingRules(utils.sheet_to_json(book.Sheets['Supporting Data'],{header:1,defval:null}));
  for(const field of result.naming.fields){const known=new Set(field.values.map(v=>v.code));if(field.index===1&&!known.has('FXX')){field.values.push({code:'FXX',description:'Updated M1 naming appendix'});known.add('FXX');}
   if(field.index===2)for(const r of scopeSource.rows){const code=r.filename.split('-')[2];if(/^[A-Z0-9]+$/.test(code||'')&&!known.has(code)){field.values.push({code,description:'Scope register TIDP filename'});known.add(code);}}
   for(const n of deliverySheets)for(const r of utils.sheet_to_json(book.Sheets[n]||{},{header:1,defval:null})){const name=text(r[0]);if(!/^M1-/i.test(name))continue;const code=name.split('-')[field.index];if(/^[A-Z0-9]+$/.test(code||'')&&!known.has(code)){field.values.push({code,description:'Current TIDP deliverable'});known.add(code);}}
  }
 }
 await env.BUCKET.put('m1/workbooks/'+key,JSON.stringify(result));return result;
}
