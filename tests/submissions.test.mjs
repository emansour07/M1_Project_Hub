import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {validateLog,matchLog,attachLogs,attachInternal,documentKey,submissionDay,mapLogRows,suggestColumns,parseLogCSV} from '../submissions-core.mjs';
import {SubmissionStore,submissionsRoute} from '../submissions.mjs';
import {deliverySummary} from '../midp-summary.mjs';
const name='M1-102-SAP-US1-05-BM003-BNM-XX-900001';
const entries=[{id:'one',name:name+'-R00',scopeId:'Island-A33',discipline:'ARCH',plannedDate:'2026-11-01'},{id:'two',name:'M1-102-SAP-US2-05-BM003-BNM-XX-900001',scopeId:'Island-A36'}];
const input=()=>({stage:'arxSapac',source:'review.xlsx',asOf:'2026-11-25',basis:'latest',baseRevision:0,rows:[{name:name+'-R00.rvt',date:'2026-11-10',reference:'1',status:'Revise and resubmit',workflowStatus:'CLOSED'},{name:name+'-R01.rvt',date:'2026-11-20',reference:'2',status:'Approved',workflowStatus:'CLOSED'},{name:name+'-R01.nwc',date:'2026-11-20',reference:'2',status:'Approved',workflowStatus:'CLOSED'}]});
const sqlFixture=()=>{const db=new DatabaseSync(':memory:');return {db,sql:{exec:(s,...a)=>{const rows=db.prepare(s).all(...a);return {toArray:()=>rows};}}};};
test('Excel dates, named months and explicit numeric date order',()=>{assert.equal(submissionDay('Nov 25, 2026, 2:04 PM'),'2026-11-25');assert.equal(submissionDay('04/05/2026','DMY'),'2026-05-04');assert.throws(()=>submissionDay('04/05/2026'));assert.throws(()=>submissionDay('2026-02-30'));assert.equal(submissionDay(46351),'2026-11-25');});
test('ACC columns and grouped file entries map without inventing dates across reviews',()=>{const matrix=[['ID','Status','Created on','File name','Review status'],['1','CLOSED','2026-11-10',name+'.rvt','Approved'],['','','',name+'.nwc','Approved'],['2','OPEN','',entries[1].name+'.rvt','']];const r=mapLogRows(matrix,0,suggestColumns(matrix[0]),'ISO',true);assert.equal(r[1].date,'2026-11-10');assert.equal(r[2].date,null);assert.equal(r[2].reference,'2');assert.throws(()=>mapLogRows(matrix,0,{name:-1,date:2},'ISO'));});
test('CSV supports quotes and revisions/formats share one identity without fuzzy joins',()=>{assert.deepEqual(parseLogCSV('File name,Submission date\n"a,b",2026-11-01'),[['File name','Submission date'],['a,b','2026-11-01']]);assert.equal(documentKey(name+'-R00.rvt'),documentKey(name+'-R01.nwc'));assert.notEqual(documentKey(name),documentKey(name.replace('SAP','ARX')));});
test('latest dates drive curves; ordinal history collapses model formats, not submissions',()=>{const p=validateLog(input()),m=matchLog(entries,p);assert.equal(m.matched,1);assert.equal(m.byId.one.date,'2026-11-20');assert.equal(m.byId.one.first,'2026-11-10');assert.equal(m.byId.one.history.length,2);const s=deliverySummary(attachLogs({entries},[p]).entries,'2026-11-25');assert.equal(s.arxSapac,1);assert.equal(s.curve.at(-1).date,'2026-11-20');assert.equal(s.sapacMace,0);});
test('voids and duplicate entries excluded, missing dates remain explicitly missing',()=>{const p=input();p.rows.push({...p.rows[0]},{name:'void.pdf',date:'2026-11-01',workflowStatus:'VOID'},{name:entries[1].name,date:null});const v=validateLog(p);assert.equal(v.voidCount,1);assert.equal(v.duplicateCount,1);assert.equal(v.missingDates,1);assert.equal(matchLog(entries,v).byId.two.date,null);});
test('ambiguous MIDP duplicates do not receive dates, and current MIDP renames re-evaluate matches',()=>{const p=validateLog(input());const m=matchLog([...entries,{...entries[0],id:'duplicate'}],p);assert.equal(m.matched,0);assert.equal(m.ambiguous.length,3);assert.equal(attachLogs({entries:[entries[1]]},[p]).submissionLogs[0].unmatched,3);});
test('stages never combine and internal review start stays outside the main curve',()=>{const p=validateLog(input()),q=validateLog({...input(),stage:'sapacMace',rows:[{name,date:'2026-11-24'}]});let snap=attachLogs({entries},[p,q]);snap=attachInternal(snap,[{id:'internal',status:'OPEN',created:Date.parse('2026-11-02T21:30:00Z'),files:[{name:name+'.rvt',version:'1'}]}]);assert.equal(snap.entries[0].internalSubmission.date,'2026-11-03');const s=deliverySummary(snap.entries,'2026-11-25');assert.equal(s.arxSapac,1);assert.equal(s.sapacMace,1);assert.equal(s.total,2);assert(!s.curve.some(d=>d.date==='2026-11-03'));});
test('replacement updates shared log without append inflation and rejects stale/older writes',()=>{const {db,sql}=sqlFixture();try{const store=new SubmissionStore(sql),p=input();assert.equal(store.save(p,entries).revision,1);assert.throws(()=>store.save(p,entries),/changed/);p.baseRevision=1;assert.throws(()=>store.save({...p,asOf:'2026-11-24'},entries),/older/);p.rows=p.rows.slice(1);store.save(p,entries);assert.equal(store.list().length,1);assert.equal(store.list()[0].rows.length,2);assert.equal(matchLog(entries,store.list()[0]).byId.one.history.length,1);}finally{db.close();}});
test('validation rejects future, empty, invalid-stage and oversized inputs',()=>{assert.throws(()=>validateLog({...input(),stage:'bad'}));assert.throws(()=>validateLog({...input(),rows:[]}));assert.throws(()=>validateLog({...input(),rows:[{name,date:'2030-01-01'}]}));assert.throws(()=>validateLog({...input(),rows:[{name:'a'.repeat(501),date:'2026-11-01'}]}));});
test('unauthorized and cross-origin users cannot publish or read private logs',async()=>{const app={env:{},templates:{}};assert.equal((await submissionsRoute(app,new Request('https://api.test/api/submissions/workspace'),false)).status,403);assert.equal((await submissionsRoute(app,new Request('https://api.test/api/submissions/import',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),true)).status,403);assert.equal((await submissionsRoute(app,new Request('https://api.test/admin/submissions'),false)).status,303);});

const aliasScope=[{id:'Island-A33',code:'A33',proposed:'US1',parcel:'102',aliases:['A33','US1']},{id:'Island-A36',code:'A36',proposed:'US2',parcel:'102',aliases:['A36','US2']}];
test('title numbers, old asset/parcel/originator codes and PDF/DWG count once',()=>{
 const old=name.replace('-102-SAP-US1-','-FXX-ARX-A33-');
 const report={rows:[{name:'Package cover.pdf',title:'Drawing: '+old+'-R02 — issued title',date:'2026-11-10',reference:'1'},{name:old+'-R02 title.dwg',date:'2026-11-10',reference:'1'}]};
 const m=matchLog(entries,report,aliasScope);assert.equal(m.matched,1);assert.equal(m.byId.one.entries,2);assert.equal(m.byId.one.history.length,1);
 assert.equal(documentKey('Report '+name+'-R00_Description.pdf'),name);
 assert.equal(matchLog(entries,{rows:[{name:name.replace('-102-','-121-'),date:'2026-11-10'}]},aliasScope).matched,0);
});
test('conflicting title, changed stage/serial and reused old asset codes never silently receive credit',()=>{
 assert.equal(matchLog(entries,{rows:[{name,title:entries[1].name}]},aliasScope).ambiguous.length,1);
 for(const n of [name.replace('-05-','-42-'),name.replace('900001','900002')])assert.equal(matchLog(entries,{rows:[{name:n}]},aliasScope).matched,0);
 const scope=aliasScope.map(a=>({...a,aliases:[...a.aliases,'OLD']}));assert.equal(matchLog(entries,{rows:[{name:name.replace('US1','OLD')}]},scope).matched,0);
 assert.equal(matchLog([...entries,{...entries[0],id:'copy'}],{rows:[{name:name.replace('-102-','-FXX-')}]},aliasScope).ambiguous.length,1);
});
test('owner mapping survives formats and code updates but stale target and duplicates stay unresolved',()=>{
 const source=name.replace('900001','955011');const p=validateLog({...input(),mappings:[{source,target:name}],rows:[{name:source+'-R00.pdf',date:'2026-11-10'},{name:source+'-R01.dwg',date:'2026-11-20'}]});
 const m=matchLog(entries,p,aliasScope);assert.equal(m.matched,1);assert.equal(m.byId.one.date,'2026-11-20');assert.deepEqual(m.byId.one.matchReasons,['Owner-saved match']);
 assert.equal(matchLog([{...entries[0],name:name.replace('-102-SAP-US1-','-FXX-ARX-A33-')}],p,aliasScope).matched,1);
 assert.equal(matchLog([{...entries[0],name:name.replace('900001','900003')}],p,aliasScope).unmatched.length,2);
 assert.equal(matchLog([...entries,{...entries[0],id:'copy'}],p,aliasScope).ambiguous.length,2);
 assert.throws(()=>validateLog({...input(),mappings:[{source,target:name},{source,target:name}]}));
 const {db,sql}=sqlFixture();try{const store=new SubmissionStore(sql);store.save({...p,baseRevision:0},entries,aliasScope);assert.deepEqual(store.list()[0].mappings,p.mappings);}finally{db.close();}
});
test('optional title column supports a drawing number without a file-name column',()=>{
 const data=[['Document title','Submission date'],['Issued '+name+'-R00 title','2026-11-10']];const r=mapLogRows(data,0,suggestColumns(data[0]),'ISO');assert.equal(matchLog(entries,{rows:r}).matched,1);
});
