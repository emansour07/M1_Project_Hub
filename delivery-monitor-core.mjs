import {deliverableCategory,deliverableStage,stageLabel,filterDeliverables} from './delivery-core.mjs';
import {submissionResolver} from './submissions-core.mjs';

export const DELIVERY_STATES=[
 {key:'outstanding',label:'Outstanding',color:'#8a919b'},
 {key:'progress',label:'In progress',color:'#397fbe'},
 {key:'submitted',label:'Submitted to SAPAC',color:'#228466'},
 {key:'returned',label:'Returned — awaiting resubmission',color:'#e38a27'},
 {key:'unknown',label:'Progress not confirmed',color:'#e2e6ec'}
];
export const HIERARCHY=['region','asset','discipline','stage'];
// Short stage names for charts, and their delivery order (code 05 is RIBA 5, so code order would mislead).
export const STAGE_SHORT={'21':'RIBA 2 · 50%','22':'RIBA 2 · 100%','31':'RIBA 3 · 50%','32':'RIBA 3 · 100%','41':'RIBA 4 · 50%','42':'RIBA 4 · 100%','50':'IFC','05':'RIBA 5','06':'Redline','07':'As-built','XX':'General','Not provided':'No stage'};
const STAGE_ORDER=['00','01','21','22','31','32','41','42','50','05','06','07','XX'],stageRank=c=>{const i=STAGE_ORDER.indexOf(c);return i<0?STAGE_ORDER.length:i;};
export function deliveryStages(rows){return [...new Set(rows.map(r=>r.stage))].sort((a,b)=>stageRank(a)-stageRank(b)||String(a).localeCompare(String(b),undefined,{numeric:true}));}
export const MAX_STAGE_COLUMNS=6;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean=v=>String(v??'').trim();
const validDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const returned=s=>/\brevise\s+(?:and|&)\s+resubmit\b|\brejected\b/i.test(s||'');
export const statusLabel=key=>DELIVERY_STATES.find(s=>s.key===key)?.label||key;
function latestSubmission(s,asOf){
 if(!s)return null;
 const history=(s.history||[]).filter(e=>validDay(e.date)&&e.date<=asOf),latest=history.map(e=>e.date).sort().at(-1);
 const date=[s.date,s.latest].find(d=>validDay(d)&&d<=asOf);
 const day=[date,latest].filter(Boolean).sort().at(-1);if(!day)return null;
 const events=history.filter(e=>e.date===day),statuses=events.flatMap(e=>e.statuses||[]);
 // The aggregate outcome belongs to the latest submission only, never an earlier round.
 if(date===day&&s.status)statuses.push(s.status);
 return {date:day,status:[...new Set(statuses)].join(' / '),references:events.map(e=>e.reference).filter(Boolean).join(', ')||s.references||''};
}
function trackerEvidence(r,columns){
 const explicit=clean(r.fields?.deliveryStatus||r.deliveryStatus);
 const states=columns.filter(c=>!c.hidden&&/^status$/i.test(c.label)).map(c=>clean(r.fields?.[c.key]));
 const values=[r.log,r.loi,r.fields?.overallCompletion];
 if(values.some(v=>typeof v==='number'&&v>0&&v<=100)||[explicit,...states].some(s=>/^(?:active|in\s*progress|submitted|complete|completed)$/i.test(s)))return 'progress';
 if([explicit,...states].some(s=>/^not\s*(?:yet\s*)?started(?:\s*yet)?$/i.test(s)))return 'outstanding';
 return null;
}
export function deliveryState(row,trackerRows=[],columns=[],asOf=today()){
 const sapac=latestSubmission(row.submissions?.arxSapac,asOf),mace=latestSubmission(row.submissions?.sapacMace,asOf);
 if(sapac){
  // A later SAPAC submission supersedes a return on the earlier submitted round.
  // MACE may also return the current or a later onward-submitted round.
  const current=mace&&mace.date>=sapac.date?mace:sapac;
  const isReturn=returned(current.status);
  return {state:isReturn?'returned':'submitted',evidence:(current===mace?'SAPAC–MACE':'ARX–SAPAC')+' log · '+(current.status||'Outcome not supplied'),sapacDate:sapac.date,maceDate:mace?.date||null,outcome:current.status,reference:current.references};
 }
 const internal=latestSubmission(row.internalSubmission,asOf);
 if(internal)return {state:'progress',evidence:'Internal review started '+internal.date,internalDate:internal.date};
 const states=trackerRows.map(r=>trackerEvidence(r,columns));
 if(states.includes('progress'))return {state:'progress',evidence:'Matched model tracker · work started'};
 if(states.includes('outstanding'))return {state:'outstanding',evidence:'Matched model tracker · Not started'};
 return {state:'unknown',evidence:mace?'Onward submission found; ARX–SAPAC log match missing':'No confirmed start or SAPAC submission',maceDate:mace?.date||null};
}
export function buildDeliveryMonitor({midp,tracker,scope}={},asOf=today()){
 const assets=scope?.rows||[],assetMap=new Map(assets.map(a=>[a.id,a]));
 const entries=(midp?.entries||[]).filter(e=>e.scopeId!=='Island-A51'&&e.scopeAsset!=='A51');
 const resolve=submissionResolver(entries,assets),byId=new Map();let ambiguousTracker=0;
 for(const t of tracker?.rows||[]){if(t.missingFromTracker)continue;
  const candidates=[...new Map([t.midpName,t.name].filter(Boolean).flatMap(resolve).filter(e=>!t.scopeId||e.scopeId===t.scopeId).map(e=>[e.id,e])).values()];
  if(candidates.length!==1){if(candidates.length>1)ambiguousTracker++;continue;}
  const id=candidates[0].id;if(!byId.has(id))byId.set(id,[]);byId.get(id).push(t);
 }
 const rows=entries.map(e=>{const asset=assetMap.get(e.scopeId),region=asset?.zone||(/^(Island|Mainland)-/.exec(e.scopeId||'')?.[1])||({'102':'Island','121':'Mainland'}[e.actualParcel])||'Region not confirmed';
  return {...e,actualOriginator:e.actualOriginator||'Not assigned',category:deliverableCategory(e),stage:deliverableStage(e),region,assetLabel:(asset?.code||e.scopeId||'Asset not assigned')+' · '+(e.scopeName||asset?.name||''),...deliveryState(e,byId.get(e.id)||[],tracker?.columns||[],asOf)};
 });
 return {rows,asOf,loaded:!!midp?.source,trackerLoaded:!!tracker?.source,ambiguousTracker,sources:{midp:midp?.source?.checkedAt||null,tracker:tracker?.source?.checkedAt||null,logs:midp?.submissionLogs||[],sync:midp?.submissionSync||null}};
}
// One place for the value a deliverable is grouped and filtered by, including the fallbacks shown to users.
export const deliveryValue=(r,k)=>k==='asset'?r.scopeId||'Asset not assigned':k==='discipline'?r.discipline||'Unclassified':k==='responsibility'?r.scopeResponsibility||'ARX':k==='actualOriginator'?r.actualOriginator||'Not assigned':r[k];
// The hierarchy position is the run of single selections from the top: region, then asset, discipline, stage.
export function deliveryPath(filters={}){const path=[];for(const k of HIERARCHY){if(filters[k]?.length!==1)break;path.push(k);}return path;}
export function filterDeliveryMonitor(rows,filters={}){
 const matches=(key,value)=>!filters[key]?.length||filters[key].includes(value),{asset,...rest}=filters;
 return filterDeliverables(rows,rest).filter(r=>matches('asset',deliveryValue(r,'asset'))&&matches('region',r.region)&&matches('state',r.state));
}
export function deliveryCounts(rows){const out=Object.fromEntries(DELIVERY_STATES.map(s=>[s.key,0]));for(const r of rows)out[r.state]++;return {...out,total:rows.length,models:rows.filter(r=>r.category==='Models').length,drawings:rows.filter(r=>r.category==='Drawings').length,categories:rows.reduce((counts,r)=>{const category=r.category||'Unclassified';counts[category]=(counts[category]||0)+1;return counts;},{})};}
export function deliveryGroups(rows,level,withParents=false){
 const pos=HIERARCHY.indexOf(level),fields=withParents?HIERARCHY.slice(0,pos+1):[level],get=deliveryValue;
 const label=(r,k)=>k==='asset'?r.assetLabel:k==='stage'?stageLabel(r.stage):get(r,k);
 const groups=new Map();for(const r of rows){const values=fields.map(k=>get(r,k)),id=JSON.stringify(values);if(!groups.has(id))groups.set(id,{id,value:get(r,level),label:fields.map(k=>label(r,k)).join(' / '),rows:[],path:Object.fromEntries(fields.map(k=>[k,get(r,k)]))});groups.get(id).rows.push(r);}
 return [...groups.values()].map(g=>({...g,counts:deliveryCounts(g.rows)})).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
}
// start = levels already fixed by the selection. depth 'view' charts only the next level below the selection.
// stageColumns puts RIBA stages side by side on each page instead of charting the stage level on its own pages.
export function progressExportPlan(rows,depth='stage',start=0,stageColumns=false){
 const all=stageColumns?deliveryStages(rows):[],stages=all.length>1&&all.length<=MAX_STAGE_COLUMNS?all:null;
 let last=depth==='view'?Math.min(start,HIERARCHY.length-1):HIERARCHY.indexOf(depth);const first=Math.min(start,last);if(stages&&last===3&&first<3)last=2;
 return HIERARCHY.slice(first,last+1).flatMap(level=>{const groups=deliveryGroups(rows,level,true),perPage=level==='stage'?7:level==='discipline'?8:10,pages=[];for(let i=0;i<groups.length;i+=perPage)pages.push({level,groups:groups.slice(i,i+perPage),part:Math.floor(i/perPage)+1,parts:Math.ceil(groups.length/perPage),stages:level==='stage'?null:stages});return pages;});
}

export function deliveryCategoryText(counts){return Object.entries(counts.categories).sort(([a],[b])=>a.localeCompare(b)).map(([name,n])=>n.toLocaleString('en-GB')+' '+name.toLowerCase()).join(' · ');}
