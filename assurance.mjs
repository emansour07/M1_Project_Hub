import {formatSnapshot} from './format-audit.mjs';
import {read,utils} from 'xlsx';
import {validateImport,importDiff,assessmentState} from './assurance-core.mjs';
import {getScope,scopeMatch} from './scope.mjs';
import {accessToken} from './forma.mjs';
export const ISSUE_PROJECT='e80ed581-2f73-4b70-a8d1-f100b9b95f4d';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const load=async(env,k,fallback=null)=>await(await env.BUCKET.get('m1/assurance/'+k))?.json()??fallback;
const put=(env,k,v)=>env.BUCKET.put('m1/assurance/'+k,JSON.stringify(v));
export class AssuranceStore{
 constructor(sql){this.sql=sql;sql.exec('CREATE TABLE IF NOT EXISTS assurance_reports (kind TEXT NOT NULL,batch TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,batch))');}
 get(kind,batch){const r=this.sql.exec('SELECT body FROM assurance_reports WHERE kind=? AND batch=?',kind,batch).toArray()[0];return r?JSON.parse(r.body):null;}
 list(){return this.sql.exec('SELECT body FROM assurance_reports ORDER BY kind,batch').toArray().map(r=>JSON.parse(r.body));}
 save(input,assets,actor){const p=validateImport(input,assets),old=this.get(p.kind,p.batch);if((old?.revision||0)!==input.baseRevision)throw Error('This register changed. Preview the report again.');if(old&&p.asOf<old.asOf)throw Error('An older report cannot replace the current register.');
  const delta=importDiff(old,p),report={...p,unmapped:undefined,revision:(old?.revision||0)+1,importedAt:Date.now(),importedBy:actor,delta,history:[...(old?.history||[]),{asOf:p.asOf,source:p.source,at:Date.now(),count:p.rows.length,delta}].slice(-30)};
  const body=JSON.stringify(report);if(new TextEncoder().encode(body).length>1800000)throw Error('This report is too large. Split it into separate scoped registers.');
  if(old)this.sql.exec('UPDATE assurance_reports SET revision=?,body=? WHERE kind=? AND batch=?',report.revision,body,p.kind,p.batch);else this.sql.exec('INSERT INTO assurance_reports(kind,batch,revision,body) VALUES(?,?,?,?)',p.kind,p.batch,report.revision,body);return report;
 }
}
export function issueRecord(raw,scope,assignment){
 const a=assignment?.scopeId?scope.rows.find(a=>a.id===assignment.scopeId):scopeMatch({name:raw.title||'',description:raw.description||'',folderPath:[raw.title||'',raw.locationDetails||'',...(raw.linkedDocuments||[]).map(x=>x.details?.viewable?.name||'')]},scope);
 if(!a||!scope.rows.some(row=>row.id===a.id))return null;return {id:String(raw.id),key:String(raw.id),title:String(raw.title||'Untitled issue').slice(0,500),reference:String(raw.displayId??''),status:String(raw.status||'Unknown'),scopeId:a.id,asset:a.proposed||a.code,assetName:a.name,discipline:assignment?.discipline||'',owner:String(raw.assignedTo||''),ownerType:String(raw.assignedToType||''),created:raw.createdAt||null,updated:raw.updatedAt||null,due:raw.dueDate||null,closed:raw.closedAt||null,description:String(raw.description||'').slice(0,3000),url:'https://acc.autodesk.eu/build/issues/projects/'+ISSUE_PROJECT+'?issueId='+encodeURIComponent(raw.id)};
}
export async function syncIssues(env,{readPage,now=Date.now()}={}){
 const state=await load(env,'issue-state',{});if(state.nextAttemptAt>now)return {updating:false,cached:true};
 await put(env,'issue-state',{...state,nextAttemptAt:now+60000});
 try{
  const scope=await getScope(env);if(!scope?.rows?.length)throw Error('Load the M1 asset scope before linking issues.');const assignments=await load(env,'assignments',{});
  let job=await load(env,'issue-job');if(!job||job.startedAt<now-1800000)job={startedAt:now,offset:0,rows:[],pending:[],seen:[],total:null};
  const token=readPage?null:await accessToken(env);
  const get=readPage|| (async offset=>{const r=await fetch('https://developer.api.autodesk.com/construction/issues/v1/projects/'+ISSUE_PROJECT+'/issues?limit=100&offset='+offset,{headers:{Authorization:'Bearer '+token,'x-ads-region':'EMEA'},redirect:'manual',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(r.status===403?'The M1 service account needs permission to view project Issues.':'ACC Issues could not be read ('+r.status+').');return r.json();});
  for(let page=0;page<5;page++){
   const d=await get(job.offset);if(!Array.isArray(d.results))throw Error('Incomplete ACC Issues response.');const total=d.pagination?.totalResults;if(!Number.isInteger(total)||total<0||total>20000)throw Error('Unexpected Issues pagination.');if(job.total!==null&&job.total!==total)throw Error('Issues changed while scanning. Refresh to restart.');job.total=total;
   for(const raw of d.results){if(!raw.id||job.seen.includes(raw.id))throw Error('Repeated issue page.');job.seen.push(raw.id);const assignment=assignments[raw.id];if(assignment?.scopeId==='exclude')continue;const row=issueRecord(raw,scope,assignment);if(row)job.rows.push(row);else if(job.pending.length<200)job.pending.push({id:String(raw.id),reference:String(raw.displayId??''),title:String(raw.title||'').slice(0,200)});}
   job.offset+=d.results.length;if(job.offset>total||!d.results.length&&job.offset<total)throw Error('Incomplete ACC Issues page.');
   if(job.offset===total){await put(env,'issues',{rows:job.rows,pending:job.pending,unassigned:job.seen.filter(id=>!assignments[id]?.scopeId&&!job.rows.some(r=>r.id===id)).length,checkedAt:now,totalVisible:job.rows.length});await put(env,'issue-job',null);await put(env,'issue-state',{checkedAt:now,nextAttemptAt:now+60000,error:null});return {ok:true,count:job.rows.length};}
  }await put(env,'issue-job',job);return {updating:true};
 }catch(e){await put(env,'issue-job',null);await put(env,'issue-state',{...state,nextAttemptAt:now+60000,error:e.message});throw e;}
}
export async function assuranceSnapshot(env,owner=false){const scope=await getScope(env),allowed=new Set((scope?.rows||[]).map(a=>a.id)),reports=new AssuranceStore(env.SQL).list().map(r=>({...r,importedBy:undefined,rows:r.rows.filter(x=>allowed.has(x.scopeId))}));const scan=reports.some(r=>r.kind==='qaqc')?await formatSnapshot(env):null;for(const r of reports)if(r.kind==='qaqc')r.rows=r.rows.map(row=>({...row,assessmentState:assessmentState(row,scan)}));const issues=await load(env,'issues',{rows:[],checkedAt:null,pending:[],unassigned:0}),state=await load(env,'issue-state',{}),links=await load(env,'links',[]);return {reports,issues:{...issues,rows:issues.rows.filter(r=>allowed.has(r.scopeId)),pending:owner?issues.pending:undefined},issueState:{checkedAt:state.checkedAt,error:owner?state.error:state.error?'The latest issue update is unavailable. The last complete check is retained.':null},links,assets:owner?scope?.rows||[]:undefined};}
async function body(req,max=2000000){const reader=req.body?.getReader();if(!reader)throw Error('Empty request.');let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('The report is too large.');}chunks.push(value);}const bytes=new Uint8Array(size);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length;}return bytes;}
export function workbookTables(bytes){
 // Validate ZIP declared expansion before passing untrusted OOXML to SheetJS.
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let expanded=0,count=0;for(let i=0;i<bytes.length-46;i++){if(view.getUint32(i,true)!==0x02014b50)continue;expanded+=view.getUint32(i+24,true);count++;if(expanded>30000000||count>3000)throw Error('Workbook is too large when expanded. Export a smaller report.');i+=45+view.getUint16(i+28,true)+view.getUint16(i+30,true)+view.getUint16(i+32,true);}
 if(!count)throw Error('Use an XLSX workbook or CSV report.');const book=read(bytes,{type:'array',cellDates:true,cellFormula:false,sheetRows:10050});return {sheets:book.SheetNames.slice(0,20).map(name=>{const sheet=book.Sheets[name],range=sheet['!ref']?utils.decode_range(sheet['!ref']):{s:{r:0,c:0}},rows=utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'}).map(r=>r.slice(0,80));for(let i=0;i<rows.length;i++)for(let j=0;j<rows[i].length;j++){const c=sheet[utils.encode_cell({r:i+range.s.r,c:j+range.s.c})];if(c?.t==='d'&&c.v instanceof Date&&Number.isFinite(c.v.getTime()))rows[i][j]=c.v.toISOString().slice(0,10);}return {name,rows};})};
}
export async function assuranceRoute(app,request,owner){
 const path=new URL(request.url).pathname,env=app.env;if(path==='/admin/assurance'&&request.method==='GET')return owner?new Response(app.templates.assuranceImportHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}}):new Response(null,{status:303,headers:{Location:'/admin/login'}});
 if(!path.startsWith('/api/assurance'))return null;
 if(path==='/api/assurance'&&request.method==='GET')return json(await assuranceSnapshot(env));
 if(request.method!=='GET'&&![new URL(request.url).origin,...(path==='/api/assurance/refresh'?[env.FRONTEND_ORIGIN]:[])].includes(request.headers.get('Origin')))return json({error:'Request not accepted.'},403);
 if(path==='/api/assurance/refresh'&&request.method==='POST'){try{return json(await syncIssues(env));}catch{return json({error:'ACC Issues could not be refreshed. The last complete check is retained.'},503);}}
 if(!owner)return json({error:'Owner access required.'},403);
 try{
  if(path==='/api/assurance/workspace'&&request.method==='GET')return json(await assuranceSnapshot(env,true));
  if(path==='/api/assurance/workbook'&&request.method==='POST')return json(workbookTables(await body(request,4000000)));
  const data=request.method==='POST'?JSON.parse(new TextDecoder().decode(await body(request))):null,scope=(await getScope(env))?.rows||[],store=new AssuranceStore(env.SQL);
  if(path==='/api/assurance/preview'&&data){const p=validateImport(data,scope),old=store.get(p.kind,p.batch);if(new TextEncoder().encode(JSON.stringify(p)).length>1700000)throw Error('Split this report into smaller scoped registers.');return json({...p,baseRevision:old?.revision||0,delta:importDiff(old,p)});}
  if(path==='/api/assurance/import'&&data)return json({saved:true,report:store.save(data,scope,env.M1_UPLOADER_EMAIL)});
  if(path==='/api/assurance/assign'&&data){const current=await load(env,'issues',{pending:[],rows:[]});if(![...current.pending,...current.rows].some(r=>r.id===data.id)||!['exclude',...scope.map(a=>a.id)].includes(data.scopeId)||typeof data.discipline!=='string'||data.discipline.length>100)throw Error('Select a current issue and scoped asset.');const assignments=await load(env,'assignments',{});assignments[data.id]={scopeId:data.scopeId,discipline:data.discipline};await put(env,'assignments',assignments);await put(env,'issue-state',{});await put(env,'issue-job',null);return json({saved:true});}
  if(path==='/api/assurance/link'&&data){const reports=store.list(),issue=(await load(env,'issues',{rows:[]})).rows.find(r=>r.id===data.issueId&&scope.some(a=>a.id===r.scopeId));if(!issue||!reports.some(r=>r.kind==='clashes'&&r.batch===data.batch&&r.rows.some(x=>x.key===data.key)))throw Error('Choose a saved clash and an in-scope ACC issue.');let links=await load(env,'links',[]);links=links.filter(r=>r.batch!==data.batch||r.key!==data.key);if(links.length>=1000)throw Error('Link limit reached.');links.push({batch:data.batch,key:data.key,issueId:data.issueId});await put(env,'links',links);return json({saved:true});}
  return json({error:'Action not available.'},405);
 }catch(e){return json({error:e.message},400);}
}
