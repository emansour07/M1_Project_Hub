import test from 'node:test';import assert from 'node:assert/strict';
import {codeImpact,trackerActive} from '../code-impact.mjs';
import {matchLog,documentKey} from '../submissions-core.mjs';
import {NEW_ASSET_CODES} from '../asset-code-policy.mjs';
import fs from 'node:fs';
const scope={rows:[{id:'Island-A33',code:'A33',proposed:'US1',aliases:['A33','US1'],parcel:'102',zone:'Island',name:'Accommodation'}]},name='M1-102-SAP-US1-05-BM010-BNM-XX-900001',e={id:'one',scopeId:'Island-A33',discipline:'Architecture',name};
test('new aliases, optional revision, separators, zero padding and drawing representation',()=>{
 const drawing='M1-102-SAP-US1-05-AR010-DWG-XX-000001';
 const variant='M1_FXX_ARX_USA_5_AR010_PDF_XX_1_REV02.pdf';
 assert.equal(matchLog([{...e,name:drawing}],{rows:[{name:variant}]},scope.rows).matched,1);
 assert.equal(documentKey(name+'-R02.nwc'),name);
 assert.equal(matchLog([e],{rows:[{name:name.replace('US1','USA')+'.ifc'}]},scope.rows).matched,1);
 assert.equal(matchLog([e],{rows:[{name:name.replace('-05-','-42-')}]},scope.rows).matched,0);
});
test('changed serials suggest but do not credit; owner mapping survives code changes',()=>{
 const old=name.replace('900001','700001');const report={rows:[{name:old.replace('US1','USA')+'-R03.pdf',date:'2026-11-20'}]};
 const m=matchLog([e],report,scope.rows,{includeSuggestions:true});assert.equal(m.matched,0);assert.equal(m.unmatched[0].suggestions[0].id,'one');
 assert.equal(matchLog([e],{...report,mappings:[{source:old,target:name}]},scope.rows).matched,1);
 assert.equal(matchLog([{...e,id:'two'},e],report,scope.rows,{includeSuggestions:true}).unmatched[0].suggestions.length,2);
});
test('impact uses file evidence, collapses aliases/formats/revisions and excludes originals/A51',()=>{
 const file=(n,id,source='progress1')=>({name:n,id,source,scopeId:'Island-A33',discipline:'Architecture',folderId:'folder'});
 const r=codeImpact({scope,midp:{entries:[e]},models:{scan:{complete:true,checkedAt:1,files:[file(name+'-R00.rvt','1'),file(name+'-R01.nwc','2'),file(name.replace('US1','USA')+'.ifc','3'),file(name.replace('900001','900002')+'.rvt','4','reference')]}}});
 assert.equal(r.total,1);assert.equal(r.affectedModels,1);assert.equal(r.rows[0].files,2);assert.equal(r.rows[0].newCode,'USA');
 assert.equal(codeImpact({scope,midp:{entries:[e]}}).affectedModels,0);
});
test('pending codes remain unchanged and active requires progress/status evidence',()=>{
 for(const id of ['Mainland-WP1','Mainland-SL1','Mainland-SL2','Island-EW-GRD','Island-EW-ROD','Island-EW-LAN','Island-EW-UTL'])assert.equal(NEW_ASSET_CODES[id],undefined);
 assert(trackerActive({log:15}));assert(trackerActive({fields:{X:'Submitted'}}));assert(!trackerActive({files:[{}],log:null,fields:{G:'Yes'}}));
 assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../company/hub/asset-code-policy.json',import.meta.url))),NEW_ASSET_CODES);
});
test('road drawings do not inflate model impact even when the folder scan includes them',()=>{
 const drawing={id:'drawing',name:'M1-102-SAP-US1-05-CV600-DWG-XX-100001.dwg',scopeId:'Island-A33',source:'progress1',discipline:'Roads'};
 assert.equal(codeImpact({scope,models:{scan:{files:[drawing]}}}).total,0);
 assert.equal(codeImpact({scope,models:{scan:{files:[drawing]}},tracker:{rows:[{files:[{id:'drawing'}]}]}}).total,1);
});
