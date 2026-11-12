import test from 'node:test';import assert from 'node:assert/strict';
import {groupModels} from '../model-formats.mjs';import {checkName,parseNamingRules} from '../naming.mjs';import {buildProgress,isProgressModel} from '../progress-core.mjs';
const stem='M1-102-SAP-A48-05-BM012-BNM-ZZ-000001';
const mapping=[{section:'10.2',existing:'A48',proposed:'CRA'},{section:'12.1',existing:'A48',proposed:'GS5'}];
const rules={fields:[{index:1,label:'Parcel',values:[{code:'102'},{code:'FXX'}]},{index:2,label:'Originator',values:[{code:'SAP'}]},{index:4,label:'Stage',values:[{code:'05'}]}],pattern:'Project-Parcel-Originator-Asset-Stage-Package-Type-Level-Number[-Revision]'};
test('naming corrects a scoped old code but never guesses an ambiguous code',()=>{
 const checked=checkName(stem+'.pdf',mapping,rules);assert.equal(checked.suggestion,stem.replace('A48','CRA')+'.pdf');
 const ambiguous=checkName(stem.replace('102','FXX')+'.pdf',mapping,rules);assert.equal(ambiguous.suggestion,null);assert.match(ambiguous.issues[0].message,/multiple proposed/);
 assert.equal(checkName(stem.replace('A48','CRA')+'.pdf',mapping,rules).state,'pass');
});
test('unknown picklist values and malformed numbers do not receive invented replacements',()=>{
 const result=checkName(stem.replace('SAP','BAD').replace('000001','1')+'.pdf',mapping,rules);assert.equal(result.suggestion,null);assert.equal(result.issues.length,3);
 assert.equal(checkName('bad_name.pdf',mapping,rules).state,'warning');assert.equal(checkName(stem+'.pdf',[],rules).state,'unchecked');
});
test('a proposed code takes precedence over an identical old code',()=>{
 const rows=[...mapping,{section:'10.2',existing:'CRA',proposed:'OTHER'}];assert.equal(checkName(stem.replace('A48','CRA')+'.pdf',rows,rules).state,'pass');
});
test('picklists are taken from named TIDP columns, retaining leading zeros',()=>{
 const rows=[['01 - Project / Parcel'],[null,'CODE'],['Parcel','011',null,'Company','SAP',null,'Stage','05',null,'Model','BM012',null,'Native','BNM',null,'Level','ZZ']];
 assert.equal(parseNamingRules(rows).fields[0].values[0].code,'011');assert.throws(()=>parseNamingRules([['Wrong']]));
});
test('all formats count once; revisions stay distinct; requirements never borrow from another source',()=>{
 const files=['rvt','nwc','ifc','dwfx'].map((ext,i)=>({id:String(i),source:i<2?'progress1':'review',name:stem+'.'+ext,updatedAt:'2026-11-01'}));
 const groups=groupModels(files,isProgressModel);assert.equal(groups.length,1);assert.deepEqual(groups[0].locations[0].missing,[]);assert.deepEqual(groups[0].locations[1].missing,['native','nwc']);
 assert.equal(groupModels([...files,{id:'extra',name:stem+'-R02.rvt',source:'progress1'}],isProgressModel).length,2);
});
test('a fresh export does not hide an old native model',()=>{
 const group=groupModels([{id:'a',name:stem+'.rvt',source:'progress1',updatedAt:'2026-11-01'},{id:'b',name:stem+'.nwc',source:'progress1',updatedAt:'2026-11-12'}],isProgressModel)[0];assert.equal(group.updatedAt,'2026-11-01');
});
test('reference and progressed model totals deduplicate by filename across formats',()=>{
 const files=['reference','progress1'].flatMap(source=>['rvt','ifc','nwc'].map(ext=>({id:source+ext,name:stem+'.'+ext,source})));
 const result=buildProgress(files,mapping,[],1);assert.equal(result.files.length,1);assert.equal(result.availability[0].models,1);assert.equal(result.availability[0].reference,1);assert.equal(result.availability[0].progressed,1);
});
