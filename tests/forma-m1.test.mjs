import test from 'node:test';import assert from 'node:assert/strict';import {mapFormaReview} from '../forma.mjs';
test('M1 review workflow labels resolve to discipline names',()=>{
 for(const [name,discipline] of [['M1_ARCH_REVIEW','Architecture'],['ARX_GEO_REVIEW','Geotechnical'],['ARX_ROD_REVIEW','Roads'],['ARX_UTL_REVIEW','Utilities'],['ATM_RIBA_2_REVIEW_MARINE','Marine']]){
  const r=mapFormaReview({id:'a',sequenceId:1,name:'Package',status:'OPEN'},{name,steps:[]},[]);assert.equal(r.discipline,discipline);
 }
});
