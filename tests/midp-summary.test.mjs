import test from 'node:test';import assert from 'node:assert/strict';
import {deliverySummary} from '../midp-summary.mjs';
import {filterDeliverables,deliverableFacets,deliverableStage,stageLabel} from '../delivery-core.mjs';
import {enrichMidpEntries} from '../midp-metadata.mjs';
const rows=[{name:'same',discipline:'ARCH',projectStage:'5',scopeResponsibility:'ARX',plannedDate:'2026-11-01',forecastDate:'2026-11-03',formats:['.rvt']},{name:'same',discipline:'MECH',projectStage:'05',scopeResponsibility:'ARX',plannedDate:'2026-11-01',formats:['.pdf']},{name:'other',discipline:'ARCH',projectStage:'42',scopeResponsibility:'ATM',plannedDate:'2026-11-04',forecastDate:'2026-11-05',formats:['.rvt']},{name:'undated',discipline:'ELEC',projectStage:'22',scopeResponsibility:'ARX',formats:['.pdf']}];
test('multi-select unions within a facet and intersects across facets, including export JSON',()=>{
 const f={stage:['05','42'],discipline:['ARCH','MECH']};assert.equal(filterDeliverables(rows,f).length,3);
 assert.equal(filterDeliverables(rows,{...f,responsibility:['ATM']}).length,1);
 assert.equal(filterDeliverables(rows,{stage:JSON.stringify(['05','42']),format:JSON.stringify(['.pdf','.rvt'])}).length,3);
 assert.equal(filterDeliverables(rows,{stage:'[]',plannedStatus:['with','without']}).length,4);
 assert.deepEqual(deliverableFacets(rows,{stage:['05'],discipline:['ARCH']}).stage,['05','42']);
 assert.equal(deliverableStage({projectStage:'5'}),'05');assert.match(stageLabel('05'),/RIBA 5/);assert.match(stageLabel('42'),/RIBA 4/);
});
test('cumulative quantities retain repeated document numbers and exclude missing dates only from curves',()=>{
 const s=deliverySummary(rows);assert.equal(s.total,4);assert.equal(s.planned,3);assert.equal(s.forecast,2);assert.equal(s.undated,1);
 assert.deepEqual(s.curve.map(d=>d.plannedTotal),[2,2,3,3]);assert.deepEqual(s.curve.map(d=>d.forecastTotal),[0,1,1,2]);
 assert.equal(deliverySummary(filterDeliverables(rows,{start:'2026-11-01',end:'2026-11-01'})).total,2);
 assert.equal(deliverySummary([]).curve.length,0);
 assert.equal(deliverySummary([{plannedDate:'2026-02-30'}]).planned,0);
});
test('scope responsibility keeps original ATM and groups all others under ARX regardless of delivery partner',()=>{
 const scope={rows:[{id:'Island-A33',zone:'Island',code:'A33',party:'Z-Dizayn',appendixParty:'ARX'},{id:'Mainland-SG2',zone:'Mainland',code:'SG2',party:'ATM'},{id:'Island-PSS1',zone:'Island',code:'PSS1',party:'ARX/ATM (Interfacing Only)'}]};
 const out=enrichMidpEntries(scope.rows.map(a=>({scopeId:a.id,name:'M1-102-SAP-XXX-05-X-X-X-X'})),scope,null);
 assert.deepEqual(out.map(r=>r.scopeResponsibility),['ARX','ATM','ARX']);
});
