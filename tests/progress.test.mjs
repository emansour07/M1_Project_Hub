import test from 'node:test';import assert from 'node:assert/strict';
import {isProgressModel,updateState,buildProgress,fileAsset} from '../progress-core.mjs';
import {excludedReferenceFolder} from '../progress.mjs';
test('conflicting filename and folder asset codes are not silently assigned',()=>{
 const mapping=[{section:'12.1',existing:'W02',proposed:'VM1'},{section:'10.2',existing:'A49',proposed:'WT2'}];
 const a=fileAsset({name:'M1-FXX-SAP-W02-05-BM012-BNM-ZZ-901001.rvt',folderPath:['WT2']},mapping);
 assert.equal(a.code,null);assert.equal(a.conflict,true);assert.deepEqual(a.candidates,['VM1','WT2']);
});
test('MIDP contributes expected asset disciplines even when no files or tracker rows exist',()=>{
 const mapping=[{section:'10.2',existing:'A48',proposed:'CRA',name:'Control Rooms A'}];
 const result=buildProgress([],mapping,[],100,200,[{name:'M1-102-SAP-A48-05-BM012-BNM-XX-000001',folderPath:[]},{name:'M1-102-SAP-UNKNOWN-05-BM010-BNM-XX-000001',folderPath:[]}]);
 assert.equal(result.availability[0].asset,'CRA');assert.equal(result.availability[0].expected,1);assert.equal(result.availability[0].reference,0);assert.equal(result.unmapped.scope,1);
});
test('reference crawl excludes Other Assets and native models distinguish infrastructure CAD',()=>{
 assert.equal(excludedReferenceFolder('Other Assets'),true);assert.equal(excludedReferenceFolder('Other_Assets'),true);assert.equal(excludedReferenceFolder('Island'),false);
 assert.equal(isProgressModel({name:'a.rvt'}),true);assert.equal(isProgressModel({name:'M1-FXX-SAP-XXX-05-BM015-BNM-XX-000001.dwg'}),true);
 assert.equal(isProgressModel({name:'drawing.dwg',folderPath:['Architecture']}),false);assert.equal(isProgressModel({name:'a.ifc'}),false);
});
test('seven-day warning uses strict elapsed time and never invents missing dates',()=>{
 const now=Date.parse('2026-11-12T12:00:00Z');assert.equal(updateState(now-7*86400000,now),'Updated this week');assert.equal(updateState(now-7*86400000-1,now),'Over 7 days');assert.equal(updateState(null,now),'Date unavailable');assert.equal(updateState(now+1,now),'Date unavailable');
});
test('legacy reference and proposed model join; duplicate roots do not inflate models',()=>{
 const mapping=[{existing:'A48',proposed:'CRA',name:'Control Rooms A'}],name='M1-FXX-SAP-CRA-05-BM012-BNM-XX-000001';
 const f={id:'m',source:'progress1',name:name+'.rvt',updatedAt:'2026-11-01T00:00:00Z'},tracker=[{name,row:5,log:80,loi:0}];
 const r=buildProgress([{id:'r',source:'reference',name:'M1-102-PAR-A48-05-BM012-BNM-XX-100001.pdf'},f,{...f,source:'progress2'}],mapping,tracker,1,Date.parse('2026-11-12'));
 assert.equal(r.availability.length,1);assert.equal(r.availability[0].drawings,1);assert.equal(r.files.length,1);assert.equal(r.files[0].log,80);assert.equal(r.files[0].loi,0);assert.equal(r.files[0].updateState,'Over 7 days');assert.equal(r.outstanding.length,0);
});
test('duplicate tracker entries do not create invented progress or false missing models',()=>{
 const name='M1-FXX-SAP-CRA-05-BM012-BNM-XX-000001';const r=buildProgress([{id:'m',source:'progress1',name:name+'.rvt'}],[{existing:'A48',proposed:'CRA'}],[{name,row:1,log:80},{name,row:2,log:60}],1);
 assert.equal(r.files[0].log,null);assert.equal(r.outstanding.length,0);
});
