// Shared by the owner importer and both hosting backends. No fuzzy filename joins.
export const STAGES={arxSapac:'ARX → SAPAC',sapacMace:'SAPAC → MACE'};
export const FIELDS={name:'Document number / File name',date:'Submission date / Created on',reference:'Review ID / Transmittal',status:'Document review outcome',workflowStatus:'Workflow status (void check)',revision:'Revision / Version'};
const text=v=>String(v??'').trim();
export const today=()=>new Date(Date.now()+4*3600000).toISOString().slice(0,10);
export function submissionDay(value,order='ISO'){
 if(value==null||text(value)===''||text(value)==='--')return null;
 if(typeof value==='number'){if(!Number.isFinite(value)||value<20000||value>100000)throw Error('Invalid Excel date.');return new Date((Math.floor(value)-25569)*86400000).toISOString().slice(0,10);}
 const s=text(value);let m=/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s),y,mo,d;
 if(m){[,y,mo,d]=m;}else if(m=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s.*)?$/.exec(s)){if(!['DMY','MDY'].includes(order))throw Error('Choose day/month or month/day for '+s);y=m[3];mo=m[order==='DMY'?2:1];d=m[order==='DMY'?1:2];}
 else {const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];m=/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s);if(m){mo=months.indexOf(m[1].slice(0,3).toLowerCase())+1;d=m[2];y=m[3];}else if(m=/^(\d{1,2})[\s-]([A-Za-z]+)[\s-](\d{4})\b/.exec(s)){d=m[1];mo=months.indexOf(m[2].slice(0,3).toLowerCase())+1;y=m[3];}else throw Error('Unrecognized date: '+s);}
 const out=[y,String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('-');if(!Number.isFinite(Date.parse(out))||new Date(out).toISOString().slice(0,10)!==out)throw Error('Invalid date: '+s);return out;
}
export function documentKey(value){return text(value).split(/[\\/]/).at(-1).toUpperCase().replace(/\.(?:PDF|RVT|IFC|NWC|NWD|DWFX|DWG|DXF|DGN|DOCX?|XLSX?)$/,'').replace(/[-_]R\d{1,3}$/,'');}
export function suggestColumns(headers){const aliases={name:['file name','filename','document number','drawing number','document no','document no.'],date:['created on','submission date','submitted date','date submitted','issue date'],reference:['id','review id','transmittal','transmittal number','reference'],status:['review status','approval status','document status','outcome'],workflowStatus:['status','workflow status'],revision:['revision','version']};return Object.fromEntries(Object.entries(aliases).map(([k,a])=>[k,headers.findIndex(h=>a.includes(text(h).toLowerCase().replace(/[_\s]+/g,' ')))]));}
export function parseLogCSV(source){source=source.replace(/^\uFEFF/,'');const delim=source.split(/\r?\n/)[0].includes('\t')?'\t':((source.split(/\r?\n/)[0].match(/;/g)||[]).length>(source.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',');const rows=[];let row=[],cell='',quote=false;for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quote&&source[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(c===delim&&!quote){row.push(cell);cell='';}else if(/[\r\n]/.test(c)&&!quote){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}if(quote)throw Error('Unclosed CSV quotation.');row.push(cell);if(row.some(text))rows.push(row);return rows;}
export function mapLogRows(matrix,header,map,order,carry=false){
 if(!Number.isInteger(header)||header<0||!matrix[header]||map.name<0||map.date<0)throw Error('Select the document and submission-date columns.');
 let group={};const rows=[];for(let i=header+1;i<matrix.length;i++){const source=matrix[i];if(!source.some(text))continue;const r=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,map[k]>=0?text(source[map[k]]):'']));if(carry){if(r.reference&&r.reference!==group.reference)group={};for(const k of ['reference','date','workflowStatus']){if(r[k])group[k]=r[k];else r[k]=group[k]||'';}}if(!r.name)continue;try{r.date=submissionDay(r.date,order);}catch(e){throw Error('Row '+(i+1)+': '+e.message);}r.sourceRow=i+1;rows.push(r);}return rows;
}
export function validateLog(input){
 if(!input||!Object.hasOwn(STAGES,input.stage)||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>15000)throw Error('Choose a submission stage and a non-empty log with up to 15,000 file entries.');
 const asOf=submissionDay(input.asOf),source=text(input.source),basis='latest';
 if(!asOf||asOf>today()||!source||source.length>250)throw Error('Confirm the log date and filename.');
 const rows=[],seen=new Set();let voidCount=0,duplicateCount=0,missingDates=0;
 for(const raw of input.rows){if(!raw||typeof raw!=='object')throw Error('Invalid log entry.');const r=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,k==='date'?submissionDay(raw[k]):text(raw[k])]));r.sourceRow=Number.isInteger(raw.sourceRow)?raw.sourceRow:rows.length+1;
  if(Object.values(r).some(v=>typeof v==='string'&&v.length>500)||!r.name)throw Error('Each entry needs a document number of at most 500 characters.');
  if(/\bVOID(?:ED)?\b/i.test(r.workflowStatus)){voidCount++;continue;}
  if(!r.date)missingDates++;else if(r.date>asOf)throw Error('Submission date is after the log date: '+r.name);
  const k=JSON.stringify([r.name.toUpperCase(),r.date,r.reference,r.revision,r.status,r.workflowStatus]);if(seen.has(k)){duplicateCount++;continue;}seen.add(k);rows.push(r);
 }
 if(!rows.length)throw Error('No non-void documents were found. The saved log is unchanged.');
 const out={stage:input.stage,source,asOf,basis,rows,voidCount,duplicateCount,missingDates};if(new TextEncoder().encode(JSON.stringify(out)).length>1700000)throw Error('The normalized log is too large. Use a scoped report below 1.7 MB after import.');return out;
}
export function matchLog(entries,report){
 const index=new Map();for(const r of entries){const key=documentKey(r.name);if(!index.has(key))index.set(key,[]);index.get(key).push(r);}
 const matched=new Map(),unmatched=[],ambiguous=[];
 for(const r of report?.rows||[]){const candidates=index.get(documentKey(r.name))||[];if(!candidates.length){unmatched.push(r);continue;}if(candidates.length!==1){ambiguous.push({...r,candidates:candidates.map(c=>({id:c.id,name:c.name,sheet:c.sheet,row:c.row,discipline:c.discipline,asset:c.scopeId}))});continue;}const id=candidates[0].id;if(!matched.has(id))matched.set(id,[]);matched.get(id).push(r);}
 const byId={};for(const [id,rows] of matched){const dates=rows.map(r=>r.date).filter(Boolean).sort(),last=dates.at(-1)||null,latest=rows.filter(r=>r.date===last),states=[...new Set(latest.map(r=>r.status).filter(Boolean))];const events=new Map();for(const r of rows){if(!r.date)continue;const key=JSON.stringify([r.date,r.reference||r.revision]);if(!events.has(key))events.set(key,{date:r.date,reference:r.reference,revisions:[],statuses:[]});const e=events.get(key);if(r.revision&&!e.revisions.includes(r.revision))e.revisions.push(r.revision);if(r.status&&!e.statuses.includes(r.status))e.statuses.push(r.status);}byId[id]={first:dates[0]||null,latest:last,date:last,status:states.join(' / '),references:[...new Set(latest.map(r=>r.reference).filter(Boolean))].join(', '),history:[...events.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.reference.localeCompare(b.reference)),entries:rows.length};}
 return {byId,matched:matched.size,unmatched,ambiguous};
}
export function attachLogs(snapshot,reports){const entries=snapshot?.entries||[],joined=reports.map(r=>({report:r,match:matchLog(entries,r)}));return {...snapshot,entries:entries.map(r=>{const submissions=Object.fromEntries(joined.filter(j=>j.match.byId[r.id]).map(j=>[j.report.stage,j.match.byId[r.id]]));return {...r,submissions,...Object.fromEntries(Object.entries(submissions).map(([k,v])=>[k+'Date',v.date]))};}),submissionLogs:joined.map(({report:r,match:m})=>({stage:r.stage,source:r.source,asOf:r.asOf,basis:r.basis,revision:r.revision,updatedAt:r.updatedAt,matched:m.matched,unmatched:m.unmatched.length,ambiguous:m.ambiguous.length}))};}
export function attachInternal(snapshot,reviews){const report={basis:'latest',rows:(reviews||[]).filter(r=>!/\bVOID(?:ED)?\b/i.test(r.status)).flatMap(r=>(r.files||[]).map(f=>({name:f.name,date:Number.isFinite(r.created)?new Date(r.created+3*3600000).toISOString().slice(0,10):null,reference:r.id,revision:f.version||'',status:f.status||'',workflowStatus:r.status})))};const match=matchLog(snapshot.entries||[],report);return {...snapshot,entries:(snapshot.entries||[]).map(r=>({...r,internalSubmission:match.byId[r.id]||null}))};}
