(function(root){
'use strict';
const DAY=86400000, clean=v=>v==null?'':String(v).trim(), norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
function date(v){
 if(v==null||v===''||v==='--')return null;
 if(typeof v==='number')return Math.round((v-25569)*DAY)-3*3600000;
 if(v instanceof Date)return v.getTime();
 let s=clean(v).replace(/,\s*(\d{1,2}:)/,' $1').replace(/UTC\+03:00/i,'+03:00');
 if(!/(?:Z|[+-]\d\d:\d\d)$/.test(s))s+=' +03:00';
 const t=Date.parse(s);return Number.isFinite(t)?t:null;
}
function discipline(w){const s=clean(w).toUpperCase();if(/(?:^|_)ARC?(?:_|$)/.test(s))return 'Architecture';if(/(?:^|_)STR?(?:_|$)/.test(s))return 'Structure';if(/(?:^|_)MECH?(?:_|$)|(?:^|_)MEC(?:_|$)/.test(s))return 'Mechanical';if(/(?:^|_)ELEC?(?:_|$)/.test(s))return 'Electrical';if(/(?:^|_)CIV(?:_|$)/.test(s))return 'Civil';return clean(w)||'Unmapped';}
function parseWorkbook(wb,XLSX,name){
 const matrices=wb.SheetNames.map(n=>({name:n,rows:XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:null,raw:true})}));
 let sheet,hi=-1;
 for(const s of matrices){const i=s.rows.findIndex(r=>r.map(norm).includes('reviewname')&&r.map(norm).includes('id')&&r.map(norm).includes('status'));if(i>=0){sheet=s;hi=i;break;}}
 if(!sheet)throw Error('No review table found. Load the original Reviews Excel export with Status, ID and Review name columns.');
 const headers=sheet.rows[hi].map(norm), col=n=>headers.indexOf(norm(n));
 const required=['Status','ID','Review name','Workflow','Next action due','Created on','Finished on','File name','Review status'];
 const missing=required.filter(n=>col(n)<0);if(missing.length)throw Error('Missing columns: '+missing.join(', ')+'. The current dashboard has been kept.');
 const groups=new Map();let rawRows=0,skipped=0;
 for(const row of sheet.rows.slice(hi+1)){
  if(!row.some(v=>clean(v)))continue;const get=n=>row[col(n)],id=clean(get('ID'));if(!id){skipped++;continue;}rawRows++;
  const round=Number(get('Current round'))||1,status=clean(get('Status')).toUpperCase();
  if(!status)throw Error('Review '+id+' has no status. Correct the log before loading it.');
  const old=groups.get(id);if(old&&round<old.round)continue;
  if(!old||round>old.round){groups.set(id,{id,round,status,name:clean(get('Review name')),workflow:clean(get('Workflow')),discipline:discipline(get('Workflow')),initiator:clean(get('Initiated by')),owner:clean(get('Next action by')),approver:clean(get('Approved by')),due:date(get('Next action due')),created:date(get('Created on')),finished:date(get('Finished on')),expectedFiles:Number(get('Total files'))||0,step:clean(get('Current step')).replace(/\n/g,' · '),steps:Number(get('Total steps'))||0,progress:clean(get('Progress')),files:[],_keys:new Set()});}
  const g=groups.get(id);if(g.status!==status)throw Error('Conflicting statuses for review '+id+' in round '+round+'. The current dashboard has been kept.');
  const filename=clean(get('File name'));if(filename){const key=[filename,clean(get('Path')),clean(get('Version'))].join('|');if(!g._keys.has(key)){g._keys.add(key);g.files.push({name:filename,path:clean(get('Path')),version:clean(get('Version')),status:clean(get('Review status')),description:clean(get('Description')),comments:clean(get('Comments')),documentType:clean(get('Document type'))});}}
 }
 if(!groups.size)throw Error('The report contains no review records.');
 const all=[...groups.values()].map(g=>{delete g._keys;return g;});
 const voids=all.filter(g=>/\bVOID(?:ED)?\b/.test(g.status));
 const reviews=all.filter(g=>!/\bVOID(?:ED)?\b/.test(g.status));
 let reportAt=null,project='',overviewTotal=null;
 for(const s of matrices.filter(s=>s!==sheet))for(const row of s.rows){const vals=row.filter(v=>v!=null&&clean(v));const label=norm(vals[0]);if(label==='createdon')reportAt=date(vals[1]);if(label==='totalreviews')overviewTotal=Number(vals[1]);if(!project&&vals.some(v=>/Madinah Superblock/i.test(clean(v))))project=clean(vals.find(v=>/Madinah Superblock/i.test(clean(v))));}
 const warnings=[];if(!reportAt)warnings.push('Report timestamp missing; upload time used as the snapshot cutoff.');if(skipped)warnings.push(skipped+' non-empty rows without review IDs skipped.');
 if(overviewTotal!=null&&overviewTotal!==all.length)warnings.push('Overview total ('+overviewTotal+') differs from unique review IDs ('+all.length+').');
 const mismatches=reviews.filter(r=>r.expectedFiles!==r.files.length);if(mismatches.length)warnings.push(mismatches.length+' reviews have a file count differing from Total files. Counts below use unique file entries in the latest round.');
 const unknown=reviews.filter(r=>!isOpen(r)&&!isClosed(r));if(unknown.length)warnings.push(unknown.length+' reviews have unrecognized statuses; see the register.');
 const missingDue=reviews.filter(r=>isOpen(r)&&r.due===null).length;if(missingDue)warnings.push(missingDue+' open reviews have no valid due date and cannot be assessed for lateness.');
 return {schema:1,name,project,reportAt:reportAt||Date.now(),loadedAt:Date.now(),reviews,voidCount:voids.length,rawRows,uniqueCount:all.length,warnings};
}
function isOpen(r){return /^OPEN(?:\b|\s|\()/.test(r.status);}
function isClosed(r){return r.status==='CLOSED';}
function outcome(f){return clean(f.status)||'Pending decision';}
function reviewOutcome(r){return [...new Set(r.files.map(outcome))].sort().join(' + ')||'Pending decision';}
function urgency(r,t){if(!isOpen(r))return isClosed(r)?'Closed':r.status;if(r.due===null)return 'No due date';if(r.due<t)return 'Overdue';if(r.due<=t+2*DAY)return 'Due in 48h';return 'On track';}
function stats(rows,t){const open=rows.filter(isOpen),closed=rows.filter(isClosed),files=rows.flatMap(r=>r.files),outcomes={};for(const f of files){const k=outcome(f);outcomes[k]=(outcomes[k]||0)+1;}const cycles=closed.filter(r=>r.created!==null&&r.finished!==null&&r.finished>=r.created).map(r=>(r.finished-r.created)/DAY);return {total:rows.length,open:open.length,closed:closed.length,overdue:open.filter(r=>urgency(r,t)==='Overdue').length,dueSoon:open.filter(r=>urgency(r,t)==='Due in 48h').length,noDue:open.filter(r=>!r.due).length,files:files.length,outcomes,rework:closed.filter(r=>r.files.some(f=>/revise|re-submit|resubmit|reject/i.test(outcome(f)))).length,cycle:cycles.length?cycles.reduce((a,b)=>a+b,0)/cycles.length:null,cycleN:cycles.length,closeRate:rows.length?closed.length/rows.length:0};}
function compare(current,previous){if(!previous)return null;const a=new Map(previous.reviews.map(r=>[r.id,r])),b=new Map(current.reviews.map(r=>[r.id,r]));return {added:current.reviews.filter(r=>!a.has(r.id)),closed:current.reviews.filter(r=>a.has(r.id)&&isOpen(a.get(r.id))&&isClosed(r)),reopened:current.reviews.filter(r=>a.has(r.id)&&isClosed(a.get(r.id))&&isOpen(r)),removed:previous.reviews.filter(r=>!b.has(r.id)),changed:current.reviews.filter(r=>a.has(r.id)&&JSON.stringify(r)!==JSON.stringify(a.get(r.id)))};}
const SIZE_BANDS=['1–4','5–10','11–20','>20'], AGE_BANDS=['≤1 day','>1–2 days','>2–3 days','>3 days'];
const PDF_TYPES=['drawing','report','other','unclassified'];
const PDF_LABELS={drawing:'Drawing',model:'Model',report:'Report',other:'Other document',unclassified:'Unclassified document',nonPdf:'CAD / model / other file'};
function pdfClassification(file,packageFiles=[]){
 const name=clean(file.name);if(!/\.pdf$/i.test(name))return {type:'nonPdf',reason:'CAD, model or other file'};
 const drawingCode=/(?:^|[^A-Z0-9])SDW(?:[^A-Z0-9]|$)/i.test(name.replace(/\.pdf$/i,''));
 const base=name.replace(/\.pdf$/i,'').toLowerCase();
 const pairedCad=packageFiles.some(f=>/\.(dwg|dxf|dgn)$/i.test(clean(f.name))&&clean(f.name).replace(/\.(dwg|dxf|dgn)$/i,'').toLowerCase()===base);
 if(drawingCode)return {type:'drawing',reason:'SDW · shop drawing'};
 if(pairedCad)return {type:'drawing',reason:'Matching CAD filename in this package'};
 const declared=clean(file.documentType).toLowerCase();
 if(['report','reports'].includes(declared))return {type:'report',reason:'Document type supplied with the file'};
 if(declared==='other')return {type:'other',reason:'Document type supplied with the file'};
 const words=name.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ');
 if(/\breports?\b/i.test(words))return {type:'report',reason:'Report identified in filename'};
 if(/\b(?:specifications?|method\s+statements?|transmittals?|cover\s+(?:letters?|sheets?))\b/i.test(words))return {type:'other',reason:'Supporting document identified in filename'};
 return {type:'unclassified',reason:'No SDW code or matching CAD filename; document type not identified'};
}
function documentClassification(file,packageFiles=[]){
 const name=clean(file.name);
 if(/\.(nwc|nwd|ifc|rvt)$/i.test(name))return {type:'model',reason:'Model format'};
 if(/\.(dwg|dxf|dgn)$/i.test(name))return {type:'drawing',reason:'CAD drawing'};
 const result=pdfClassification(file,packageFiles);
 return result.type==='nonPdf'?{type:'other',reason:'Other document format'}:result;
}
const documentType=(file,packageFiles=[])=>documentClassification(file,packageFiles).type;
const modelCount=r=>(r.files||[]).filter(f=>documentType(f,r.files)==='model').length;
const documentCount=(r,type)=>type==='model'?modelCount(r):pdfCounts(r)[type]||0;
const pdfType=(file,packageFiles=[])=>pdfClassification(file,packageFiles).type;
function pdfCounts(r){const counts={drawing:0,report:0,other:0,unclassified:0,total:0};for(const f of r.files||[]){const type=pdfType(f,r.files);if(type!=='nonPdf'){counts[type]++;counts.total++;}}return counts;}
const pdfCount=r=>pdfCounts(r).total;
const drawingCount=r=>pdfCounts(r).drawing;
const sizeBand=n=>n<1?'No drawings':n<5?'1–4':n<=10?'5–10':n<=20?'11–20':'>20';
function reviewDays(r,t){const end=isClosed(r)?r.finished:isOpen(r)?t:null;return Number.isFinite(r.created)&&Number.isFinite(end)&&end>=r.created?(end-r.created)/DAY:null;}
const ageBand=n=>n===null?'Unknown age':n<=1?'≤1 day':n<=2?'>1–2 days':n<=3?'>2–3 days':'>3 days';
function drawingMetrics(rows,t,scope='open'){
 const result={total:0,open:0,closed:0,other:0,packages:0,noDrawingPackages:0,models:0,pdfTypes:{drawing:0,report:0,other:0,unclassified:0},sizes:Object.fromEntries(SIZE_BANDS.map(k=>[k,0])),age:Object.fromEntries(AGE_BANDS.map(k=>[k,0])),unknownAge:0,ageTotal:0,cumulative:[0,0,0]};
 for(const r of rows){if(/\bVOID(?:ED)?\b/i.test(r.status))continue;const counts=pdfCounts(r);result.models+=modelCount(r);for(const type of PDF_TYPES)result.pdfTypes[type]+=counts[type];const n=counts.drawing;if(!n){result.noDrawingPackages++;continue;}result.total+=n;result.packages++;result.sizes[sizeBand(n)]++;result[isOpen(r)?'open':isClosed(r)?'closed':'other']+=n;
  if(scope==='open'?!isOpen(r):!isClosed(r))continue;result.ageTotal+=n;const days=reviewDays(r,t);if(days===null){result.unknownAge+=n;continue;}result.age[ageBand(days)]+=n;for(let i=0;i<3;i++)if(days<=i+1)result.cumulative[i]+=n;
 }return result;
}
function workloadMatches(r,value,t){if(!value)return true;const [kind,arg,band]=value.split('|'),n=drawingCount(r);if(kind==='document')return [...PDF_TYPES,'model'].includes(arg)&&documentCount(r,arg)>0;if(kind==='size'&&arg==='No drawings')return n===0;if(!n)return false;
 if(kind==='all')return true;if(kind==='state')return arg==='Reviewed'?isClosed(r):arg==='Under review'?isOpen(r):!isOpen(r)&&!isClosed(r);
 if(kind==='size')return sizeBand(n)===arg;
 if(kind==='age'||kind==='within'){if(arg==='open'?!isOpen(r):!isClosed(r))return false;const days=reviewDays(r,t);return kind==='age'?ageBand(days)===band:days!==null&&days<=Number(band);}
 return false;
}
function workloadLabel(value){const [kind,arg,band]=value.split('|');return kind==='document'?PDF_LABELS[arg]:kind==='all'?'Drawings':kind==='state'?arg+' · drawings':kind==='size'?arg+' drawings / package':kind==='within'?'Within '+band+' days · '+(arg==='open'?'under review':'completed'):kind==='age'?band+' · '+(arg==='open'?'under review':'completed'):value;}
function formaReviewUrl(r,project){const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;const projectId=clean(project).replace(/^b\./,'');return uuid.test(projectId)&&uuid.test(r.autodeskId||'')?'https://acc.autodesk.eu/docs/reviews/projects/'+projectId+'/'+r.autodeskId:null;}
root.M1={DAY,date,discipline,parseWorkbook,isOpen,isClosed,outcome,reviewOutcome,urgency,stats,compare,pdfCount,drawingCount,pdfCounts,pdfType,pdfClassification,documentType,documentClassification,modelCount,documentCount,PDF_TYPES,PDF_LABELS,sizeBand,reviewDays,ageBand,drawingMetrics,workloadMatches,workloadLabel,SIZE_BANDS,AGE_BANDS,formaReviewUrl};
if(typeof module!=='undefined')module.exports=root.M1;
})(typeof window!=='undefined'?window:globalThis);
