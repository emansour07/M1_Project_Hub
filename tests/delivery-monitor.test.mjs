import test from 'node:test';
import assert from 'node:assert/strict';
import PptxGenJS from 'pptxgenjs';
import {unzipSync,strFromU8} from 'fflate';
import {deliveryState,buildDeliveryMonitor,deliveryCounts,filterDeliveryMonitor,deliveryGroups,progressExportPlan,deliveryPath,deliveryValue,incomingStage,contractualStage,deliveryRates} from '../delivery-monitor-core.mjs';
import {createDeliveryPpt} from '../delivery-monitor-ppt.mjs';
const name='M1-102-SAP-US1-05-BM010-BNM-XX-900001-R00',entry=(id='one')=>({id,name,scopeId:'Island-A33',scopeAsset:'US1',scopeName:'Accommodation',discipline:'ARCH',category:'Models',plannedDate:'2026-12-01'}),asOf='2026-11-28';
const log=(date,status)=>({date,status,history:[{date,statuses:status?[status]:[],reference:'R1'}]});
const scope={rows:[{id:'Island-A33',code:'A33',proposed:'US1',zone:'Island',parcel:'102',aliases:['A33','US1','USA']}]};
test('all four approved outcomes use latest round and later resubmission clears orange',()=>{
 for(const status of ['approved','approved w/ comments','Approved with comments',''])assert.equal(deliveryState({...entry(),submissions:{arxSapac:log('2026-11-10',status)}},[],[],asOf).state,'submitted');
 for(const status of ['revise and resubmit','rejected','Revise & Resubmit'])assert.equal(deliveryState({...entry(),submissions:{arxSapac:log('2026-11-10',status)}},[],[],asOf).state,'returned');
 const s=log('2026-11-10','Rejected');s.history.push({date:'2026-11-20',statuses:[],reference:'R2'});s.date='2026-11-20';s.status='';assert.equal(deliveryState({...entry(),submissions:{arxSapac:s}},[],[],asOf).state,'submitted');
});
test('MACE returns apply to current round, not a superseded round; onward log alone is not SAPAC credit',()=>{
 const r={...entry(),submissions:{arxSapac:log('2026-11-10','Approved'),sapacMace:log('2026-11-12','Rejected')}};
 assert.equal(deliveryState(r,[],[],asOf).state,'returned');r.submissions.arxSapac=log('2026-11-20','');assert.equal(deliveryState(r,[],[],asOf).state,'submitted');
 delete r.submissions.arxSapac;assert.equal(deliveryState(r,[],[],asOf).state,'returned');
});
test('nothing recorded is outstanding; tracker submitted is not evidence of SAPAC issue',()=>{
 assert.equal(deliveryState(entry(),[{log:0,loi:null,fields:{}}],[],asOf).state,'outstanding');assert.equal(deliveryState(entry(),[],[],asOf).evidence,'No activity or submission recorded');
 assert.equal(deliveryState(entry(),[{fields:{deliveryStatus:'Not started'}}],[],asOf).state,'outstanding');
 assert.equal(deliveryState(entry(),[{log:20,fields:{deliveryStatus:'Not started'}}],[],asOf).state,'progress');
 assert.equal(deliveryState(entry(),[{fields:{X:'Submitted'}}],[{key:'X',label:'Status'}],asOf).state,'progress');
 assert.equal(deliveryState({...entry(),internalSubmission:log('2026-11-02','Rejected')},[],[],asOf).state,'progress');
 assert.equal(deliveryState({...entry(),submissions:{arxSapac:log('2027-01-01','Approved')}},[],[],asOf).state,'outstanding');
});
test('one TIDP row each, no duplicate credit, no cross-stage matching, all categories retained with no cross-category tracker credit',()=>{
 const one=entry(),two={...entry('two'),name:name.replace('-05-','-42-')},excluded={...entry('a51'),scopeId:'Island-A51'},report={...entry('report'),name:name.replace('-BNM-','-RPT-')};
 const data={midp:{source:{checkedAt:1},entries:[one,two,excluded,report]},tracker:{rows:[{name:name.replace('-102-SAP-US1-','-FXX-ARX-A33-'),scopeId:'Island-A33',log:40}],columns:[]},scope};
 let r=buildDeliveryMonitor(data,asOf);assert.equal(r.rows.length,3);assert.deepEqual(r.rows.map(r=>r.state),['progress','outstanding','outstanding']);
 data.midp.entries.push({...one,id:'duplicate'});r=buildDeliveryMonitor(data,asOf);assert.equal(r.rows.length,4);assert(r.rows.every(r=>r.state==='outstanding'));assert.equal(r.ambiguousTracker,1);
});
test('formats and submission histories never inflate deliverable quantities; scopes and dates cascade',()=>{
 const entries=[{...entry(),formats:['rvt','nwc','ifc','dwfx'],submissions:{arxSapac:log('2026-11-10','Rejected')}},{...entry('drawing'),name:name.replace('BNM','DWG'),plannedDate:null}];
 const r=buildDeliveryMonitor({midp:{source:{},entries},scope},asOf),c=deliveryCounts(r.rows);assert.equal(c.total,2);assert.equal(c.models,1);assert.equal(c.drawings,1);assert.equal(c.returned,1);
 assert.equal(filterDeliveryMonitor(r.rows,{start:'2026-12-01',end:'2026-12-01'}).length,1);assert.equal(filterDeliveryMonitor(r.rows,{stage:['42']}).length,0);assert.equal(filterDeliveryMonitor(r.rows,{state:['returned']}).length,1);
 for(const level of ['region','asset','discipline','stage'])assert.equal(deliveryGroups(r.rows,level).reduce((n,g)=>n+g.counts.total,0),2);
 assert.equal(progressExportPlan(r.rows).length,4);
});
test('PPTX contains editable charts, source dates, return colour and reconciled native chart data',async()=>{
 const rows=['outstanding','progress','submitted','returned','mace'].map((state,i)=>({...entry(String(i)),state,region:'Island',assetLabel:'A33 · Accommodation',stage:'05'}));
 const ppt=createDeliveryPpt(PptxGenJS,{rows,report:{asOf,sources:{midp:1,tracker:1,logs:[]}},depth:'stage'}),bytes=await ppt.write({outputType:'uint8array'}),zip=unzipSync(bytes);
 assert.equal(Object.keys(zip).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,5);
 const charts=Object.keys(zip).filter(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n));assert.equal(charts.length,5);
 for(const file of charts){const xml=strFromU8(zip[file]);assert.match(xml,/E38A27/i);assert.match(xml,/externalData/);assert.match(xml,/Returned/);}
 assert(Object.keys(zip).some(n=>/embeddings\/.*\.xlsx$/.test(n)));
 assert.match(strFromU8(zip['ppt/slides/slide1.xml']),/2026-11-28/);
});


test('all MIDP categories reconcile with the project total and category filters',()=>{
 const types=['BNM','DWG','RPT','CAL','SPE','SCH','ZZZ'];
 const entries=types.map((type,i)=>({...entry(String(i)),name:name.replace('BNM',type),category:type==='ZZZ'?'Custom deliverables':undefined,submissions:{arxSapac:log('2026-11-10',i===2?'Rejected':'Approved')}}));
 const report=buildDeliveryMonitor({midp:{source:{},entries},scope},asOf),counts=deliveryCounts(report.rows);
 assert.equal(counts.total,types.length);
 assert.equal(Object.values(counts.categories).reduce((a,b)=>a+b,0),types.length);
 assert.equal(counts.categories.Reports,1);assert.equal(counts.categories['Custom deliverables'],1);
 assert.equal(counts.returned,1);assert.equal(counts.submitted,6);
 assert.equal(filterDeliveryMonitor(report.rows,{category:['Reports','Calculations']}).length,2);
 for(const level of ['region','asset','discipline','stage'])assert.equal(deliveryGroups(report.rows,level).reduce((n,g)=>n+g.counts.total,0),types.length);
});

test('selection path follows single choices from the top; exports start below the selection',()=>{
 assert.deepEqual(deliveryPath({}),[]);assert.deepEqual(deliveryPath({region:['Island'],asset:['Island-A33'],stage:['05']}),['region','asset']);
 assert.deepEqual(deliveryPath({region:['Island','Mainland'],asset:['Island-A33']}),[]);assert.deepEqual(deliveryPath({asset:['Island-A33']}),[]);
 const entries=[['ARCH','05'],['ARCH','42'],['STR','05']].map(([discipline,stage],i)=>({...entry(String(i)),discipline,name:name.replace('-05-','-'+stage+'-').replace('900001','90000'+i)}));
 const rows=buildDeliveryMonitor({midp:{source:{},entries},scope},asOf).rows;
 assert.deepEqual(progressExportPlan(rows,'view',0).map(p=>p.level),['region']);
 assert.deepEqual(progressExportPlan(rows,'view',2).map(p=>p.level),['discipline']);
 assert.deepEqual(progressExportPlan(rows,'view',4).map(p=>p.level),['stage']);
 assert.deepEqual(progressExportPlan(rows,'stage',1).map(p=>p.level),['asset','discipline','stage']);
 assert.deepEqual(progressExportPlan(rows,'region',2).map(p=>p.level),['region']);
 // Asset → discipline → RIBA stage keeps every deliverable exactly once at each level.
 const stages=progressExportPlan(rows,'stage',1).at(-1).groups;assert.equal(stages.length,3);assert.equal(stages.reduce((n,g)=>n+g.counts.total,0),3);
 assert.deepEqual(stages.map(g=>[g.path.asset,g.path.discipline,g.path.stage]),[['Island-A33','ARCH','05'],['Island-A33','ARCH','42'],['Island-A33','STR','05']]);
});
test('unassigned deliverables stay selectable and counted under their displayed group',()=>{
 const rows=buildDeliveryMonitor({midp:{source:{},entries:[entry(),{...entry('loose'),scopeId:'',discipline:''}]},scope},asOf).rows,loose=rows.find(r=>r.id==='loose');
 assert.equal(deliveryValue(loose,'asset'),'Asset not assigned');assert.equal(deliveryValue(loose,'discipline'),'Unclassified');assert.equal(deliveryValue(loose,'responsibility'),'ARX');
 assert.equal(filterDeliveryMonitor(rows,{asset:['Asset not assigned']}).length,1);assert.equal(filterDeliveryMonitor(rows,{asset:['Island-A33']}).length,1);
 assert.equal(deliveryGroups(rows,'asset').reduce((n,g)=>n+g.counts.total,0),2);
});
test('PPTX for a selection starts below it, carries the selection text and keeps native charts',async()=>{
 const rows=['progress','submitted','mace'].map((state,i)=>({...entry(String(i)),state,region:'Island',assetLabel:'A33 · Accommodation',stage:i?'05':'42'}));
 const ppt=createDeliveryPpt(PptxGenJS,{rows,report:{asOf,sources:{midp:1,tracker:1,logs:[]}},depth:'view',start:2,title:'A33 delivery status',context:'Whole project › Island › A33 | 3 of 9 project deliverables'}),zip=unzipSync(await ppt.write({outputType:'uint8array'}));
 assert.equal(Object.keys(zip).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,2);
 const first=strFromU8(zip['ppt/slides/slide1.xml']);assert.match(first,/A33 delivery status/);assert.match(first,/3 of 9 project deliverables/);
 assert.equal(Object.keys(zip).filter(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n)).length,2);
});
test('PPTX stage columns: one native chart per RIBA stage, same rows, no separate stage pages, totals reconcile',async()=>{
 const rows=[['ARCH','22','progress'],['ARCH','42','submitted'],['STR','42','mace'],['STR','05','returned']].map(([discipline,stage,state],i)=>({...entry(String(i)),discipline,stage,state,region:'Island',assetLabel:'A33 · Accommodation'}));
 const plan=progressExportPlan(rows,'stage',0,true);assert.deepEqual(plan.map(p=>p.level),['region','asset','discipline']);assert.deepEqual(plan[0].stages,['22','42','05']);
 assert.deepEqual(progressExportPlan(rows,'stage',0,false).map(p=>p.level),['region','asset','discipline','stage']);
 assert.deepEqual(progressExportPlan(rows,'view',3,true).map(p=>[p.level,p.stages]),[['stage',null]]);
 assert.equal(progressExportPlan(rows.filter(r=>r.stage==='42'),'stage',0,true)[0].stages,null);
 for(const page of plan)for(const g of page.groups)assert.equal(page.stages.reduce((n,c)=>n+g.rows.filter(r=>r.stage===c).length,0),g.counts.total);
 const ppt=createDeliveryPpt(PptxGenJS,{rows,report:{asOf,sources:{midp:1,tracker:1,logs:[]}},depth:'stage',stageColumns:true}),zip=unzipSync(await ppt.write({outputType:'uint8array'}));
 assert.equal(Object.keys(zip).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,4);
 const charts=Object.keys(zip).filter(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n));assert.equal(charts.length,1+3*3);
 const xml=charts.map(n=>strFromU8(zip[n]));for(const x of xml)assert.match(x,/externalData/);
 for(const name of ['RIBA 2 · 100%','RIBA 4 · 100%','RIBA 5'])assert.equal(xml.filter(x=>x.includes(name+'  |  ')).length,3);
 assert.match(strFromU8(zip['ppt/slides/slide3.xml']),/by RIBA stage/);
});
test('two reported positions: Submitted to SAPAC from the ARX log, Submitted to MACE for MIDP items in the SAPAC log',()=>{
 const sapac=log('2026-11-10','Approved'),mace=log('2026-11-12','Approved');
 // ARX log only: with SAPAC. Both logs: the later MACE round is the position. MACE log only: still reported as with MACE.
 assert.equal(deliveryState({...entry(),submissions:{arxSapac:sapac}},[],[],asOf).state,'submitted');
 assert.deepEqual(deliveryState({...entry(),submissions:{arxSapac:sapac,sapacMace:mace}},[],[],asOf),{state:'approved',evidence:'SAPAC–MACE log · Approved',sapacDate:'2026-11-10',maceDate:'2026-11-12',outcome:'Approved',reference:'R1'});
 assert.deepEqual(deliveryState({...entry(),submissions:{sapacMace:mace}},[{fields:{deliveryStatus:'Not started'}}],[],asOf),{state:'approved',evidence:'SAPAC–MACE log · Approved',sapacDate:null,maceDate:'2026-11-12',outcome:'Approved',reference:'R1'});
 // Returns by either party stay orange; a later ARX resubmission to SAPAC supersedes the MACE round.
 assert.equal(deliveryState({...entry(),submissions:{sapacMace:log('2026-11-12','Revise and resubmit')}},[],[],asOf).state,'returned');
 assert.equal(deliveryState({...entry(),submissions:{arxSapac:log('2026-11-20','Approved'),sapacMace:log('2026-11-12','Rejected')}},[],[],asOf).state,'submitted');
 // A MACE entry dated after the snapshot is not yet a position.
 assert.equal(deliveryState({...entry(),submissions:{sapacMace:log('2027-01-01','Approved')}},[],[],asOf).state,'outstanding');
 const rows=buildDeliveryMonitor({midp:{source:{},entries:[entry(),{...entry('b'),submissions:{sapacMace:mace}},{...entry('c'),submissions:{arxSapac:sapac}}]},scope},asOf).rows,c=deliveryCounts(rows);
 assert.deepEqual([c.outstanding,c.progress,c.submitted,c.mace,c.approved,c.returned,c.total],[1,0,1,0,1,0,3]);assert.equal('unknown' in c,false);
 assert.equal(filterDeliveryMonitor(rows,{state:['approved']}).length,1);
});

test('contractual scope follows the MIDP summary: stages after the incoming stage, unknown assets unmarked',()=>{
 assert.equal(incomingStage('Island-DC1'),'RIBA 3');assert.equal(incomingStage('Island-A33'),'RIBA 4');assert.equal(incomingStage('Island-NEW'),null);
 assert.deepEqual(['22','32','42','05'].map(s=>contractualStage('Island-G01',s)),[false,false,true,true]);
 assert.deepEqual(['42','05','Not provided'].map(s=>contractualStage('Mainland-EW-GRD',s)),[false,true,false]);
 assert.equal(contractualStage('Mainland-SIO','42'),true);assert.equal(contractualStage('Island-NEW','05'),null);
 const rows=buildDeliveryMonitor({midp:{source:{},entries:[entry(),{...entry('b'),name:name.replace('-05-','-42-')}]},scope},asOf).rows;assert.deepEqual(rows.map(r=>[r.stage,r.contractual]),[['05',true],['42',false]]);
});
test('MACE position: under review is Submitted to MACE, codes A and B are Approved by MACE; completion and approval reconcile',()=>{
 const state=status=>deliveryState({...entry(),submissions:{arxSapac:log('2026-11-10','Approved'),sapacMace:log('2026-11-12',status)}},[],[],asOf).state;
 assert.deepEqual(['Under review','','Code X1','Approved','Approved w/ comments','approved with comments','Revise and resubmit','Rejected'].map(state),['mace','mace','mace','approved','approved','approved','returned','returned']);
 // SAPAC's own approval of an ARX submission is not MACE approval.
 assert.equal(deliveryState({...entry(),submissions:{arxSapac:log('2026-11-10','Approved')}},[],[],asOf).state,'submitted');
 const rows=['outstanding','outstanding','progress','submitted','submitted','mace','approved','returned'].map((s,i)=>({...entry(String(i)),state:s})),rate=deliveryRates(deliveryCounts(rows));
 assert.deepEqual([rate.completed,rate.approved,rate.total],[4,1,8]);assert.equal(rate.completion,.5);assert.equal(rate.approval,.125);
 assert.deepEqual(deliveryRates(deliveryCounts([])),{completed:0,approved:0,total:0,completion:0,approval:0});
});
