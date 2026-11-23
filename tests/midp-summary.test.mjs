import test from 'node:test';import assert from 'node:assert/strict';
import {deliverySummary,cumulativePath} from '../midp-summary.mjs';
import {filterDeliverables,deliverableFacets,deliverableStage,stageLabel} from '../delivery-core.mjs';
import {enrichMidpEntries} from '../midp-metadata.mjs';
const rows=[{name:'same',discipline:'ARCH',projectStage:'5',scopeResponsibility:'ARX',plannedDate:'2026-11-01',latestIssueDate:'2026-11-03',formats:['.rvt']},{name:'same',discipline:'MECH',projectStage:'05',scopeResponsibility:'ARX',plannedDate:'2026-11-01',formats:['.pdf']},{name:'other',discipline:'ARCH',projectStage:'42',scopeResponsibility:'ATM',plannedDate:'2026-11-04',latestIssueDate:'2026-11-05',formats:['.rvt']},{name:'undated',discipline:'ELEC',projectStage:'22',scopeResponsibility:'ARX',formats:['.pdf']}];
test('multi-select unions within a facet and intersects across facets, including export JSON',()=>{
 const f={stage:['05','42'],discipline:['ARCH','MECH']};assert.equal(filterDeliverables(rows,f).length,3);
 assert.equal(filterDeliverables(rows,{...f,responsibility:['ATM']}).length,1);
 assert.equal(filterDeliverables(rows,{stage:JSON.stringify(['05','42']),format:JSON.stringify(['.pdf','.rvt'])}).length,3);
 assert.equal(filterDeliverables(rows,{stage:'[]',plannedStatus:['with','without']}).length,4);
 assert.deepEqual(deliverableFacets(rows,{stage:['05'],discipline:['ARCH']}).stage,['05','42']);
 assert.equal(deliverableStage({projectStage:'5'}),'05');assert.match(stageLabel('05'),/RIBA 5/);assert.match(stageLabel('42'),/RIBA 4/);
});
test('cumulative quantities retain repeated document numbers and exclude missing dates only from curves',()=>{
 const s=deliverySummary(rows);assert.equal(s.total,4);assert.equal(s.planned,3);assert.equal(s.actual,2);assert.equal(s.undated,1);
 assert.deepEqual(s.curve.map(d=>d.plannedTotal),[2,2,3,3]);assert.deepEqual(s.curve.map(d=>d.actualTotal),[0,1,1,2]);
 assert.equal(deliverySummary(filterDeliverables(rows,{start:'2026-11-01',end:'2026-11-01'})).total,2);
 assert.equal(deliverySummary([]).curve.length,0);
 assert.equal(deliverySummary([{plannedDate:'2026-02-30'}]).planned,0);
});
test('scope responsibility keeps original ATM and groups all others under ARX regardless of delivery partner',()=>{
 const scope={rows:[{id:'Island-A33',zone:'Island',code:'A33',party:'Z-Dizayn',appendixParty:'ARX'},{id:'Mainland-SG2',zone:'Mainland',code:'SG2',party:'ATM'},{id:'Island-PSS1',zone:'Island',code:'PSS1',party:'ARX/ATM (Interfacing Only)'}]};
 const out=enrichMidpEntries(scope.rows.map(a=>({scopeId:a.id,name:'M1-102-SAP-XXX-05-X-X-X-X'})),scope,null);
 assert.deepEqual(out.map(r=>r.scopeResponsibility),['ARX','ATM','ARX']);
});

test('streamlined curve interpolates recorded totals without changing endpoints',()=>{
 const p=[[0,100],[30,70],[90,0]],smooth=cumulativePath(p),steps=cumulativePath(p,false);
 assert.equal(smooth,'M0.00 100.00 C10.00 100.00 20.00 70.00 30.00 70.00 C50.00 70.00 70.00 0.00 90.00 0.00');
 assert.equal(steps,'M0.00 100.00 H30.00 V70.00 H90.00 V0.00');
});
test('actual curve uses latest MIDP issue date once per deliverable and excludes future issues',()=>{
 const s=deliverySummary([{latestIssueDate:'2026-11-10',exchanges:[{date:'2026-11-01'},{date:'2026-11-10'}]},{latestIssueDate:'2026-12-01'},{forecastDate:'2026-11-05'}],'2026-11-23');
 assert.equal(s.actual,1);assert.equal(s.curve.length,1);assert.equal(s.curve[0].actualTotal,1);
});
