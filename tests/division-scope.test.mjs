import test from 'node:test';
import assert from 'node:assert/strict';
import {divisionScope,responsibilityFor} from '../division-scope.mjs';
test('Z-Dizayn models seven Island assets without changing Appendix responsibility or Mainland',()=>{
 const assigned=divisionScope.filter(a=>a.party==='Z-Dizayn');
 assert.deepEqual(assigned.map(a=>a.code).sort(),['A33','A36','A37','A48','C48','D48','E48']);
 assert.ok(assigned.every(a=>a.zone==='Island'&&a.appendixParty==='ARX'&&a.deliveryRole.startsWith('Modelling')));
 assert.equal(responsibilityFor({zone:'Island',code:'A55'}).party,'ARX');
 assert.equal(responsibilityFor({zone:'Mainland',code:'A33',name:'Unknown'}),null);
});
