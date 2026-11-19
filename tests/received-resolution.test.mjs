import test from 'node:test';import assert from 'node:assert/strict';
import {receivedMatrix,receivedKey} from '../received-core.mjs';
import {resolveReceivedRows,referenceScopedFile,validateReceived} from '../received.mjs';
const ids=['Mainland-WT1','Mainland-SP','Subsea-SS1','Island-EW-UTL','Island-EW-ROD','Mainland-SL1','Mainland-SL2','Island-DT1'];
const policy={rows:ids.map(id=>({id,code:id.split('-').slice(1).join('-'),zone:id.split('-')[0],name:id,aliases:id==='Island-DT1'?['DT1','A51']:id.endsWith('SL1')||id.endsWith('SL2')?['P02']:[],ambiguous:[]}))};
const make=(name,description='',source='')=>({id:name,name,description,source,scopeId:'pending',assetAssignmentPending:true,discipline:'Original discipline',revision:'',formats:{}});
test('explicit A51 exclusion wins over an erroneous DT1 alias and reviewed pending import',()=>{
 const a=make('M1-FXX-SAP-A51-05-BM100-BFM-XX-900020','Electrical Substation');
 assert.equal(resolveReceivedRows([a],policy).length,0);assert.equal(referenceScopedFile({...a,name:a.name+'.nwc'},policy),null);
 const kept=make('M1-FXX-SAP-MW1-05-BM010-BNM-XX-901001','Water Tank 1','MIDP M1 - 121-ARX-WT1');
 assert.equal(validateReceived({rows:[a,kept],scopeReviewed:true,sourceCheckedAt:1},policy).rows.length,1);
});
test('resolve evidence-backed aliases and area descriptions without changing source names',()=>{
 const rows=[make('M1-FXX-SAP-MW1-05-BM010-BNM-XX-901001'),make('M1-FXX-SAP-SWP-05-BM100-BFM-XX-900026'),make('M1-YYY-SAP-TP1-05-BM100-BFM-XX-900037'),make('M1-102-HES-XXX-42-BM046-BNM-MP-901000','SEWAGE NETWORK'),make('M1-FXX-SAP-XXX-05-BM100-BFM-XX-900013','Island External Works - Roads, Fencing & Gates')];
 const result=resolveReceivedRows(rows,policy);assert.deepEqual(result.map(r=>r.scopeId),ids.slice(0,5));assert.deepEqual(result.map(r=>r.name),rows.map(r=>r.name));assert.ok(result.every(r=>!r.assetAssignmentPending));
 const f=referenceScopedFile({name:rows[0].name+'.rvt',folderPath:['Mainland']},policy);assert.equal(f.scopeId,'Mainland-WT1');
});
test('group confirmed P02 models once and keep water station pending with evidence',()=>{
 const rows=[make('M1-121-PAR-P02-42-BM012-BNM-ZZ-901001','Storm lifting station'),make('M1-121-PAR-XXX-42-BM036-BNM-ZZ-901002','Water station site works'),make('M1-102-HES-XXX-42-BM100-BFM-XX-900001','Parcel 10.2 Federated Model'),make('M1-102-SAP-MW1-05-BM010-BNM-XX-901001')];
 const result=resolveReceivedRows(rows,policy);assert.ok(result.filter((r,i)=>i===1||i===3).every(r=>r.assetAssignmentPending));assert.equal(result[0].scopeId,'Mainland-SL1-SL2');assert.deepEqual(result[0].sharedAssets,['Mainland-SL1','Mainland-SL2']);assert.match(result[1].assignmentComment,/WATER PUMP STATION/);assert.equal(receivedMatrix([result[0]]).cells.length,0);assert.equal(result[2].scopeId,'Island-wide');assert.equal(result[2].areaWide,true);assert.equal(receivedMatrix([result[2]]).cells.length,0);
});

test('road alignments and traffic models remain distinct within the same asset',()=>{
 const a='M1-121-PAR-ROD-42-BM015-BNM-XX-000001';
 assert.notEqual(receivedKey(a,'Mainland-EW-ROD'),receivedKey(a.replace('-ROD-','-TRF-'),'Mainland-EW-ROD'));
 assert.equal(receivedKey(a.replace('-ROD-','-TRF-')+'.rvt','Mainland-EW-ROD'),receivedKey(a.replace('-ROD-','-TRF-')+'.nwc','Mainland-EW-ROD'));
});
