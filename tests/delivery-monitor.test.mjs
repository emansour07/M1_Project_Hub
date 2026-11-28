import test from 'node:test';
import assert from 'node:assert/strict';
import PptxGenJS from 'pptxgenjs';
import {unzipSync,strFromU8} from 'fflate';
import {deliveryState,buildDeliveryMonitor,deliveryCounts,filterDeliveryMonitor,deliveryGroups,progressExportPlan,deliveryPath,deliveryValue} from '../delivery-monitor-core.mjs';
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
 delete r.submissions.arxSapac;assert.equal(deliveryState(r,[],[],asOf).state,'unknown');
});
test('blank/zero progress is unknown, not outstanding; tracker submitted is not evidence of SAPAC issue',()=>{
 assert.equal(deliveryState(entry(),[{log:0,loi:null,fields:{}}],[],asOf).state,'unknown');
 assert.equal(deliveryState(entry(),[{fields:{deliveryStatus:'Not started'}}],[],asOf).state,'outstanding');
 assert.equal(deliveryState(entry(),[{log:20,fields:{deliveryStatus:'Not started'}}],[],asOf).state,'progress');
 assert.equal(deliveryState(entry(),[{fields:{X:'Submitted'}}],[{key:'X',label:'Status'}],asOf).state,'progress');
 assert.equal(deliveryState({...entry(),internalSubmission:log('2026-11-02','Rejected')},[],[],asOf).state,'progress');
 assert.equal(deliveryState({...entry(),submissions:{arxSapac:log('2027-01-01','Approved')}},[],[],asOf).state,'unknown');
});
test('one TIDP row each, no duplicate credit, no cross-stage matching, all categories retained with no cross-category tracker credit',()=>{
 const one=entry(),two={...entry('two'),name:name.replace('-05-','-42-')},excluded={...entry('a51'),scopeId:'Island-A51'},report={...entry('report'),name:name.replace('-BNM-','-RPT-')};
 const data={midp:{source:{checkedAt:1},entries:[one,two,excluded,report]},tracker:{rows:[{name:name.replace('-102-SAP-US1-','-FXX-ARX-A33-'),scopeId:'Island-A33',log:40}],columns:[]},scope};
 let r=buildDeliveryMonitor(data,asOf);assert.equal(r.rows.length,3);assert.deepEqual(r.rows.map(r=>r.state),['progress','unknown','unknown']);
 data.midp.entries.push({...one,id:'duplicate'});r=buildDeliveryMonitor(data,asOf);assert.equal(r.rows.length,4);assert(r.rows.every(r=>r.state==='unknown'));assert.equal(r.ambiguousTracker,1);
});
test('formats and submission histories never inflate deliverable quantities; scopes and dates cascade',()=>{
 const entries=[{...entry(),formats:['rvt','nwc','ifc','dwfx'],submissions:{arxSapac:log('2026-11-10','Rejected')}},{...entry('drawing'),name:name.replace('BNM','DWG'),plannedDate:null}];
 const r=buildDeliveryMonitor({midp:{source:{},entries},scope},asOf),c=deliveryCounts(r.rows);assert.equal(c.total,2);assert.equal(c.models,1);assert.equal(c.drawings,1);assert.equal(c.returned,1);
 assert.equal(filterDeliveryMonitor(r.rows,{start:'2026-12-01',end:'2026-12-01'}).length,1);assert.equal(filterDeliveryMonitor(r.rows,{stage:['42']}).length,0);assert.equal(filterDeliveryMonitor(r.rows,{state:['returned']}).length,1);
 for(const level of ['region','asset','discipline','stage'])assert.equal(deliveryGroups(r.rows,level).reduce((n,g)=>n+g.counts.total,0),2);
 assert.equal(progressExportPlan(r.rows).length,4);
});
test('PPTX contains editable charts, source dates, return colour and reconciled native chart data',async()=>{
 const rows=['outstanding','progress','submitted','returned','unknown'].map((state,i)=>({...entry(String(i)),state,region:'Island',assetLabel:'A33 · Accommodation',stage:'05'}));
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
 const rows=['progress','submitted','unknown'].map((state,i)=>({...entry(String(i)),state,region:'Island',assetLabel:'A33 · Accommodation',stage:i?'05':'42'}));
 const ppt=createDeliveryPpt(PptxGenJS,{rows,report:{asOf,sources:{midp:1,tracker:1,logs:[]}},depth:'view',start:2,title:'A33 delivery status',context:'Whole project › Island › A33 | 3 of 9 project deliverables'}),zip=unzipSync(await ppt.write({outputType:'uint8array'}));
 assert.equal(Object.keys(zip).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,2);
 const first=strFromU8(zip['ppt/slides/slide1.xml']);assert.match(first,/A33 delivery status/);assert.match(first,/3 of 9 project deliverables/);
 assert.equal(Object.keys(zip).filter(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n)).length,2);
});
