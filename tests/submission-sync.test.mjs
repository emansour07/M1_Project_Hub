import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {utils,write} from 'xlsx';
import {logStage,pickLogFiles,locateLogTable,logDateOrder,logFromSheets,registerTable,registerRows,registerDay} from '../submission-sync-core.mjs';
import {syncSubmissionLogs,submissionSyncStatus} from '../submission-sync.mjs';
import {SubmissionStore} from '../submissions.mjs';
import {validateLog,matchLog} from '../submissions-core.mjs';
const name='M1-102-SAP-US1-05-BM003-BNM-XX-900001',other='M1-102-SAP-US2-05-BM003-BNM-XX-900001';
const entries=[{id:'one',name:name+'-R00',scopeId:'Island-A33',discipline:'ARCH'},{id:'two',name:other,scopeId:'Island-A36'}];
const head=['ID','Status','Created on','File name','Review status'];
const report=(...rows)=>[['M1 review report'],[],head,...rows];
const book=matrix=>{const wb=utils.book_new();utils.book_append_sheet(wb,utils.aoa_to_sheet([['Cover']]),'Notes');utils.book_append_sheet(wb,utils.aoa_to_sheet(matrix),'Reviews');return new Uint8Array(write(wb,{type:'array',bookType:'xlsx'}));};
function environment(){const db=new DatabaseSync(':memory:'),objects=new Map();return {db,env:{SQL:{exec:(s,...a)=>{const rows=db.prepare(s).all(...a);return {toArray:()=>rows};}},BUCKET:{get:async k=>objects.has(k)?{json:async()=>JSON.parse(objects.get(k))}:null,put:async(k,v)=>{objects.set(k,v);}}}};}
const files=(a='v1',b='v1')=>[{id:'arx',name:'M1-ARX-SAP-Review_Report.xlsx',versionId:a},{id:'mac',name:'M1-SAP-MAC-Review_Report.xlsx',versionId:b},{id:'x',name:'Notes.xlsx',versionId:'1'}];

test('the two ACC workbooks are recognised by name only; duplicates and missing files are reported, never guessed',()=>{
 assert.equal(logStage('M1-ARX-SAP-Review_Report.xlsx'),'arxSapac');assert.equal(logStage('m1-sap-mac-review report.XLSX'),'sapacMace');
 for(const n of ['~$M1-ARX-SAP-Review_Report.xlsx','M1-ARX-SAP-Review_Report (1).xlsx','M1-ARX-MAC-Review_Report.xlsx','M1-ARX-SAP-Review_Report.csv',''])assert.equal(logStage(n),null);
 const picked=pickLogFiles(files());assert.equal(picked.arxSapac.file.id,'arx');assert.equal(picked.sapacMace.file.id,'mac');
 assert.match(pickLogFiles([files()[0],files()[0]]).arxSapac.error,/More than one/);assert.match(pickLogFiles([files()[0]]).sapacMace.error,/not in the Submission_Logs folder/);
});
test('sheet, header row and grouped review rows are read as on the upload page',()=>{
 const sheets=[{name:'Notes',rows:[['Cover']]},{name:'Reviews',rows:report(['1','CLOSED','2026-11-10',name+'-R00.rvt','Revise and resubmit'],['','','',name+'-R00.nwc','Revise and resubmit'],['2','CLOSED','2026-11-20',name+'-R01.rvt','Approved'],['3','VOID','2026-11-21',other+'.rvt','Approved'])}];
 const table=locateLogTable(sheets);assert.equal(table.sheetName,'Reviews');assert.equal(table.header,2);
 const log=logFromSheets(sheets,{stage:'arxSapac',source:'a.xlsx',asOf:'2026-11-25T08:00:00Z'});assert.equal(log.asOf,'2026-11-25');assert.equal(log.rows.length,4);
 assert.equal(log.rows[1].date,'2026-11-10');assert.equal(log.rows[1].reference,'1');
 const valid=validateLog(log);assert.equal(valid.rows.length,3);assert.equal(valid.voidCount,1);
 assert.throws(()=>locateLogTable([{name:'x',rows:[['Title','Owner']]}]),/No sheet/);
 assert.throws(()=>logFromSheets([{name:'x',rows:[head]}],{stage:'arxSapac',source:'a',asOf:'2026-11-25'}),/no document rows/);
});
test('numeric dates are read only when the log proves the order; a future file date never post-dates the log',()=>{
 const rows=d=>[head,...d.map((x,i)=>[String(i),'CLOSED',x,name+'.rvt','Approved'])];
 assert.equal(logDateOrder(rows(['2026-11-10','Nov 25, 2026, 2:04 PM']),0,2),'ISO');
 assert.equal(logDateOrder(rows(['04/05/2026','25/05/2026']),0,2),'DMY');assert.equal(logDateOrder(rows(['04/05/2026','05/25/2026']),0,2),'MDY');
 assert.throws(()=>logDateOrder(rows(['04/05/2026','05/06/2026']),0,2),/cannot be confirmed/);assert.throws(()=>logDateOrder(rows(['25/05/2026','05/25/2026']),0,2),/mixes/);
 assert.equal(logFromSheets([{name:'s',rows:rows(['04/05/2026','25/05/2026'])}],{stage:'arxSapac',source:'a',asOf:'2026-06-01'}).rows[0].date,'2026-05-04');
 const limit=new Date(Date.now()+4*3600000).toISOString().slice(0,10);assert.equal(logFromSheets([{name:'s',rows:rows(['2026-11-10'])}],{stage:'arxSapac',source:'a',asOf:'2999-01-01'}).asOf,limit);
});
test('scheduled pull publishes both logs once per ACC version, keeps saved matches and the last good log on failure',async()=>{
 const {db,env}=environment();try{
  const store=new SubmissionStore(env.SQL),books={arx:book(report(['1','CLOSED','2026-11-10',name+'-R00.rvt','Rejected'])),mac:book(report(['7','CLOSED','2026-11-12',other+'.rvt','Approved']))};let downloads=0,list=files();
  const services={entries,scope:[],store,list:async()=>list,download:async(_e,id)=>{downloads++;return {bytes:books[id],source:{name:list.find(f=>f.id===id).name,versionId:list.find(f=>f.id===id).versionId,version:1,updatedAt:'2026-11-20T10:00:00Z'}};}};
  let result=await syncSubmissionLogs(env,false,services);assert.equal(downloads,2);assert.deepEqual(result.logs.map(l=>[l.stage,l.state,l.asOf,l.sheet,l.headerRow]),[['arxSapac','published','2026-11-20','Reviews',3],['sapacMace','published','2026-11-20','Reviews',3]]);
  assert.deepEqual(store.list().map(r=>[r.stage,r.revision,r.source,r.rows.length]),[['arxSapac',1,'M1-ARX-SAP-Review_Report.xlsx',1],['sapacMace',1,'M1-SAP-MAC-Review_Report.xlsx',1]]);
  // Within the interval nothing is contacted; a forced check with unchanged versions downloads nothing.
  assert.equal((await syncSubmissionLogs(env,false,services)).skipped,true);await syncSubmissionLogs(env,true,services);assert.equal(downloads,2);assert.equal(store.list()[0].revision,1);
  // A new ACC version of one log is published as revision 2; the other log is untouched.
  list=files('v2');books.arx=book(report(['1','CLOSED','2026-11-10',name+'-R00.rvt','Rejected'],['2','CLOSED','2026-11-18',name+'-R01.rvt','Approved']));
  result=await syncSubmissionLogs(env,true,services);assert.equal(downloads,3);assert.deepEqual(store.list().map(r=>r.revision),[2,1]);assert.equal(store.list()[0].rows.length,2);
  // An unreadable newer version leaves the published log in place and says why; it is tried again later.
  list=files('v3');books.arx=book([['Title','Owner'],['a','b']]);
  result=await syncSubmissionLogs(env,true,services);const arx=result.logs[0];assert.equal(arx.state,'kept');assert.match(arx.error,/No sheet/);assert.equal(arx.versionId,'v2');assert.equal(store.list()[0].revision,2);
  await syncSubmissionLogs(env,true,services);assert.equal(downloads,5);
  // A missing file is reported without touching the published log.
  list=[files('v3')[0]];books.arx=book(report(['1','CLOSED','2026-11-10',name+'-R00.rvt','Rejected']));
  result=await syncSubmissionLogs(env,true,services);assert.equal(result.logs[1].state,'missing');assert.equal(store.list()[1].revision,1);assert.equal(result.logs[0].state,'published');
  assert.equal((await submissionSyncStatus(env)).logs[0].file,'M1-ARX-SAP-Review_Report.xlsx');
 }finally{db.close();}
});
test('owner-saved matches survive an automatic pull; a log with no MIDP match or an older date is not published',async()=>{
 const {db,env}=environment();try{
  const store=new SubmissionStore(env.SQL),mappings=[{source:'OLD-NUMBER-1',target:other}];
  store.save({stage:'arxSapac',source:'manual.xlsx',asOf:'2026-11-15',rows:[{name:name+'.rvt',date:'2026-11-10'}],mappings,baseRevision:0},entries,[]);
  const list=[{id:'arx',name:'M1-ARX-SAP-Review_Report.xlsx',versionId:'v1'}];let bytes=book(report(['1','CLOSED','2026-11-10','OLD-NUMBER-1.pdf','Approved'])),updatedAt='2026-11-20T10:00:00Z';
  const services={entries,scope:[],store,list:async()=>list,download:async()=>({bytes,source:{name:list[0].name,versionId:list[0].versionId,updatedAt}})};
  let result=await syncSubmissionLogs(env,true,services);assert.equal(result.logs[0].state,'published');assert.deepEqual(store.list()[0].mappings,mappings);assert.equal(store.list()[0].revision,2);
  list[0].versionId='v2';bytes=book(report(['1','CLOSED','2026-11-10','UNKNOWN-DOCUMENT.pdf','Approved']));
  result=await syncSubmissionLogs(env,true,services);assert.equal(result.logs[0].state,'kept');assert.match(result.logs[0].error,/No unique MIDP matches/);assert.equal(store.list()[0].revision,2);
  list[0].versionId='v3';bytes=book(report(['1','CLOSED','2026-11-10',name+'.rvt','Approved']));updatedAt='2026-11-12T10:00:00Z';
  result=await syncSubmissionLogs(env,true,services);assert.match(result.logs[0].error,/older log/);assert.equal(store.list()[0].asOf,'2026-11-20');
 }finally{db.close();}
});
test('a folder that cannot be listed changes nothing and is retried soon',async()=>{
 const {db,env}=environment();try{const store=new SubmissionStore(env.SQL);const result=await syncSubmissionLogs(env,true,{entries,scope:[],store,list:async()=>{throw Error('403');}});
  assert.match(result.error,/could not be checked/);assert.equal(store.list().length,0);assert.equal((await syncSubmissionLogs(env,false,{entries,scope:[],store,list:async()=>[]})).skipped,true);
 }finally{db.close();}
});

const midpName='M1-FXX-SAP-US1-05-BM003-BNM-XX-900001';
const registerSheet=(...rows)=>[['mace','','Contractor_F (M1) - SHD'],['No.','CRS Number','Item Description','Latest Rev.','Latest WF.','Current Status','First Revision','','','','','Second Revision','','',''],['','','','','','','Date','WF No.','Response','Discipline','Code','Date','WF No.','Response','Code'],...rows];
test('MACE register: every category sheet, drawing number from Item Description, one round per dated revision',()=>{
 const sheets=[{name:'Shop Drawing',rows:registerSheet(
   ['1','M1-SAP-FXX-CRS-STR-0001',midpName+'- RIBA 5 – A33 General Report','R01','31400','A','2026-11-02','31366','2026-11-09','STR','C','10/Nov/26','31400','','A'],
   ['2','M1-SAP-FXX-CRS-CIV-0007','M1-SAP-FXX-DRS-CIV-0005 _ PROPOSED GENERAL SITE LOCATION','R00','25664','D','02/Sep/26','25664','05/Sep/26','CIV','D','','','',''],
   ['3','M1-SAP-FXX-CRS-CIV-0011','M1-SAP-FXX-DRS-CIV-0009 - BATCHING PLANT','R00','25668','UR','06-Sep-2026','25668','','CIV','UR','n/a','','',''],
   ['','','','','','','','','','','','','','',''])},
  {name:'BIM',rows:registerSheet(['1','M1-SAP-FXX-CRS-BIM-0001','M1-102-SAP-US2-05-BM003-BNM-XX-900001 MODEL','R00','400','X1','2026-11-03','400','','BIM','X1','','','',''])},
  {name:'All Document Statistics',rows:[['Category','Count'],['Shop Drawing',3]]}];
 assert.equal(registerTable(sheets[2].rows),null);assert.deepEqual(registerTable(sheets[0].rows).revisions.map(r=>[r.label,r.date,r.reference,r.code]),[['First Revision',6,7,10],['Second Revision',11,12,14]]);
 const r=registerRows(sheets);assert.deepEqual(r.sheets,['Shop Drawing','BIM']);assert.equal(r.undated,1);
 assert.deepEqual(r.rows.map(x=>[x.date,x.reference,x.revision,x.status]),[['2026-11-02','31366','First Revision','Revise and resubmit'],['2026-11-10','31400','Second Revision','Approved'],['2026-09-02','25664','First Revision','Rejected'],['2026-09-06','25668','First Revision','Under review'],['2026-11-03','400','First Revision','Code X1']]);
 assert.equal(registerDay('02/Sep/26'),'2026-09-02');assert.equal(registerDay('1 November 2026'),'2026-11-01');assert.equal(registerDay(''),null);assert.equal(registerDay('31/Feb/26'),undefined);assert.equal(registerDay('04/05/2026'),undefined);
 // Through the normal log path: SAPAC's own documents stay unmatched, the MIDP deliverable takes its latest round.
 const log=logFromSheets(sheets,{stage:'sapacMace',source:'M1-SAP-MAC-Review_Report.xlsx',asOf:'2026-11-20'}),valid=validateLog(log),m=matchLog([{id:'one',name:'M1-102-SAP-US1-05-BM003-BNM-XX-900001-R00',scopeId:'Island-A33'},{id:'two',name:'M1-102-SAP-US2-05-BM003-BNM-XX-900001',scopeId:'Island-A36'}],valid,[{id:'Island-A33',code:'A33',proposed:'US1',zone:'Island',parcel:'102',aliases:['A33','US1']},{id:'Island-A36',code:'A36',proposed:'US2',zone:'Island',parcel:'102',aliases:['A36','US2']}]);
 assert.equal(log.table.dateOrder,'register');assert.equal(valid.rows.length,5);assert.equal(m.matched,2);assert.equal(m.unmatched.length,2);
 assert.equal(m.byId.one.date,'2026-11-10');assert.equal(m.byId.one.status,'Approved');assert.equal(m.byId.one.history.length,2);assert.equal(m.byId.two.status,'Code X1');
 assert.throws(()=>logFromSheets([{name:'S',rows:registerSheet(['1','x','y','','','','','','','','','','','',''])}],{stage:'sapacMace',source:'a',asOf:'2026-11-20'}),/no dated revisions/);
});
