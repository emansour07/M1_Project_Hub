import {stored} from './worker.mjs';
import {validateLog,matchLog,attachLogs,attachInternal,STAGES,searchSubmissionEntries} from './submissions-core.mjs';
import {workbookTables} from './assurance.mjs';
import {getScope} from './scope.mjs';
import {midpSnapshot} from './workbooks.mjs';
import {syncSubmissionLogs,submissionSyncStatus} from './submission-sync.mjs';
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export class SubmissionStore{
 constructor(sql){this.sql=sql;sql.exec('CREATE TABLE IF NOT EXISTS submission_logs (stage TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL)');}
 list(){return this.sql.exec('SELECT body FROM submission_logs ORDER BY stage').toArray().map(r=>JSON.parse(r.body));}
 save(data,entries,scope=[]){const p=validateLog(data),old=this.list().find(r=>r.stage===p.stage);if(!Number.isInteger(data.baseRevision)||(old?.revision||0)!==data.baseRevision)throw Error('This log changed. Preview it again before publishing.');if(old&&p.asOf<old.asOf)throw Error('An older log cannot replace the current log.');const m=matchLog(entries,p,scope);if(!m.matched)throw Error('No unique MIDP matches. Check the document column before publishing.');const report={...p,revision:(old?.revision||0)+1,updatedAt:Date.now()};const body=JSON.stringify(report);const saved=old?this.sql.exec('UPDATE submission_logs SET body=?, revision=? WHERE stage=? AND revision=? RETURNING stage',body,report.revision,p.stage,data.baseRevision):this.sql.exec('INSERT INTO submission_logs(stage,body,revision) VALUES(?,?,1) ON CONFLICT(stage) DO NOTHING RETURNING stage',p.stage,body);if(!saved.toArray().length)throw Error('Another update was published. Preview again.');return report;}
}
// ARX–SAPAC log entries that could not be tied to exactly one MIDP deliverable, so the gap can be listed and closed.
// SAPAC–MACE is left out on purpose: its other entries are SAPAC scope, not ARX reporting.
export function submissionGaps(entries,reports,scope=[]){
 const report=(reports||[]).find(r=>r.stage==='arxSapac');if(!report)return null;
 const m=matchLog(entries||[],report,scope),cut=(v,n)=>String(v??'').slice(0,n),row=(r,kind)=>({kind,name:cut(r.name,200),title:cut(r.title,200),date:r.date||null,reference:cut(r.reference,80),revision:cut(r.revision,40),status:cut(r.status,80),reason:cut(r.reason,160),sourceRow:r.sourceRow??null});
 return {stage:'arxSapac',source:report.source,asOf:report.asOf,total:report.rows.length,rows:[...m.unmatched.map(r=>row(r,'Not in the MIDP')),...m.ambiguous.map(r=>row(r,'More than one match'))].slice(0,2000)};
}
// CSV for the owner download. Cells that a spreadsheet would read as a formula are neutralised.
export function gapsCsv(g){const safe=v=>/^[=+@\-\t\r]/.test(String(v??''))?"'"+v:v??'',line=cells=>cells.map(v=>'"'+String(safe(v)).replaceAll('"','""')+'"').join(',');
 return '\ufeff'+[line(['Submitted document','Title','Submission date','Review ID','Revision','Outcome','Why not mapped','Detail','Log row','Log file','Log date']),...g.rows.map(r=>line([r.name,r.title,r.date,r.reference,r.revision,r.status,r.kind,r.reason,r.sourceRow,g.source,g.asOf]))].join('\r\n');}
export async function withSubmissionLogs(env,snapshot){const scope=(await getScope(env))?.rows||[],reports=new SubmissionStore(env.SQL).list(),joined=attachInternal(attachLogs(snapshot,reports,scope),(await stored(env)).data.current?.reviews||[],scope);return {...joined,submissionSync:env.BUCKET?await submissionSyncStatus(env):null};}
async function body(request,max){const reader=request.body?.getReader();if(!reader)throw Error('Select a file first.');let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('The upload exceeds the size limit.');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;}
export async function submissionsRoute(app,request,owner){
 const url=new URL(request.url),path=url.pathname,env=app.env;
 if(path==='/admin/submissions'&&request.method==='GET')return owner?new Response(app.templates.submissionsHtml,{headers:{'Content-Type':'text/html;charset=utf-8'}}):new Response(null,{status:303,headers:{Location:'/admin/login'}});
 if(!path.startsWith('/api/submissions/'))return null;
 if(!owner)return json({error:'Owner access required.'},403);
 if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({error:'Request not accepted.'},403);
 try{
  const store=new SubmissionStore(env.SQL);
  if(path==='/api/submissions/workspace'&&request.method==='GET')return json({reports:store.list().map(({rows,...r})=>({...r,count:rows.length})),stages:STAGES});
  if(path==='/api/submissions/workbook'&&request.method==='POST'){const parsed=workbookTables(await body(request,4000000),{strict:true});if(parsed.sheets.some(s=>s.rows.length>=10050))throw Error('The worksheet exceeds 10,000 entries. Export a smaller log.');return json(parsed);}
  if(path==='/api/submissions/search'&&request.method==='GET')return json({entries:searchSubmissionEntries((await midpSnapshot(env))?.entries||[],url.searchParams.get('q'))});
  // Owner-only CSV of ARX → SAPAC log entries that match no single MIDP deliverable.
  if(path==='/api/submissions/unmapped'&&request.method==='GET'){const g=submissionGaps((await midpSnapshot(env))?.entries||[],store.list(),(await getScope(env))?.rows||[]);if(!g)return json({error:'No ARX → SAPAC log is published.'},404);return new Response(gapsCsv(g),{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="M1_ARX_SAPAC_Not_Mapped_'+g.asOf+'.csv"','Cache-Control':'no-store'}});}
  // Owner can ask for the ACC logs to be read now instead of waiting for the next scheduled check.
  if(path==='/api/submissions/sync'&&request.method==='POST')return json(await syncSubmissionLogs(env,true));
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const data=JSON.parse(new TextDecoder().decode(await body(request,2000000))),entries=(await midpSnapshot(env))?.entries||[],scope=(await getScope(env))?.rows||[];
  if(!entries.length)throw Error('Load the MIDP before importing a submission log.');
  if(path==='/api/submissions/preview'){const p=validateLog(data),m=matchLog(entries,p,scope,{includeSuggestions:true}),old=store.list().find(r=>r.stage===p.stage),oldMatches=old?matchLog(entries,old,scope):null;return json({baseRevision:old?.revision||0,matched:m.matched,unmatched:m.unmatched,ambiguous:m.ambiguous,voidCount:p.voidCount,duplicateCount:p.duplicateCount,missingDates:p.missingDates,removedMatches:oldMatches?Object.keys(oldMatches.byId).filter(id=>!m.byId[id]).length:0,sample:entries.filter(r=>m.byId[r.id]).slice(0,30).map(r=>({name:r.name,asset:r.scopeId,discipline:r.discipline,...m.byId[r.id]}))});}
  if(path==='/api/submissions/import'){const report=store.save(data,entries,scope);return json({saved:true,stage:report.stage,revision:report.revision});}
  return json({error:'Action not available.'},404);
 }catch(e){return json({error:e.message},400);}
}
