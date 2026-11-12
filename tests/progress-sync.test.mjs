import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {syncProgress,progressSnapshot} from '../progress.mjs';import {sources} from '../sources.mjs';
import {nextPath} from '../models.mjs';
test('pagination accepts equivalent encoded folder URNs but rejects different folders and hosts',()=>{
 const path='/data/v1/projects/b.test/folders/urn%3Aadsk.wipemea%3Afs.folder%3Aco.test/contents';
 assert.equal(nextPath('https://developer.api.autodesk.com'+decodeURIComponent(path)+'?page[number]=2',path),path+'?page[number]=2');
 assert.throws(()=>nextPath('https://example.com'+path+'?page[number]=2',path),/Unexpected/);
 assert.throws(()=>nextPath('https://developer.api.autodesk.com'+path.replace('co.test','co.other'),path),/Unexpected/);
});
function environment(){const db=new DatabaseSync(':memory:'),objects=new Map();const env={ACC_PROJECT_ID:'test',SQL:{exec(query,...args){const stmt=db.prepare(query);const rows=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>rows};}},BUCKET:{async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},async put(key,value){objects.set(key,value);return {etag:'x'};}}};objects.set('m1/workbooks/tidp',JSON.stringify({rows:[{existing:'A48',proposed:'CRA'}]}));objects.set('m1/workbooks/tracker',JSON.stringify({rows:[]}));return {env,objects,db};}
const folder=(id,name)=>({id,type:'folders',attributes:{name}});
test('large scans resume across bounded invocations and publish only after completion',async()=>{
 const {env,objects,db}=environment();let calls=0;
 const read=async path=>{calls++;const id=decodeURIComponent(path.split('/folders/')[1].split('/contents')[0]);return {data:id===sources.reference?[folder('island','Island'),folder('mainland','Mainland'),folder('subsea','Subsea'),folder('excluded','Other Assets')]:id===sources.progress1?Array.from({length:25},(_,i)=>folder('p'+i,'models'+i)):[]};};
 assert.equal((await syncProgress(env,true,read,async()=>'test')).updating,true);assert.equal(calls,18);assert.equal((await progressSnapshot(env)).scan,null);
 assert.equal((await syncProgress(env,true,read,async()=>'test')).updating,true);assert.equal(calls,18);
 const s=JSON.parse(objects.get('m1/progress/state'));s.batchNotBefore=0;objects.set('m1/progress/state',JSON.stringify(s));
 assert.equal((await syncProgress(env,true,read,async()=>'test')).ok,true);assert.equal((await progressSnapshot(env)).scan.complete,true);assert.equal(db.prepare("SELECT COUNT(*) n FROM progress_queue WHERE task LIKE '%excluded%'").get().n,0);db.close();
});
test('permission failure retains the last complete generation',async()=>{
 const {env,objects,db}=environment();objects.set('m1/progress/state',JSON.stringify({published:'last',checkedAt:123,lastAttempt:0}));
 await assert.rejects(()=>syncProgress(env,true,async()=>{throw Error('Forbidden');},async()=>'test'));
 const s=JSON.parse(objects.get('m1/progress/state'));assert.equal(s.published,'last');assert.equal(s.checkedAt,123);assert.equal(s.active,false);db.close();
});
test('retry resumes staged folders instead of discarding completed work',async()=>{
 const {env,objects,db}=environment();let failed=false,rootReads=0;
 const read=async path=>{const id=decodeURIComponent(path.split('/folders/')[1].split('/contents')[0]);if(id===sources.reference){rootReads++;return {data:[folder('island','Island'),folder('mainland','Mainland'),folder('subsea','Subsea')]};}if(id===sources.progress1&&!failed){failed=true;throw Error('Temporary provider error');}return {data:[]};};
 await assert.rejects(()=>syncProgress(env,true,read,async()=>'test'));
 const s=JSON.parse(objects.get('m1/progress/state'));assert.ok(s.retryGeneration);s.nextAt=0;s.lastAttempt=0;objects.set('m1/progress/state',JSON.stringify(s));
 assert.equal((await syncProgress(env,true,read,async()=>'test')).ok,true);assert.equal(rootReads,1);assert.equal((await progressSnapshot(env)).scan.complete,true);db.close();
});
test('manual refresh cannot bypass provider rate-limit backoff',async()=>{
 const {env,objects,db}=environment();let calls=0;const retryAt=Date.now()+900000;
 await assert.rejects(()=>syncProgress(env,true,async()=>{calls++;const e=Error('Rate limited');e.status=429;e.retryAt=retryAt;throw e;},async()=>'test'));
 const s=JSON.parse(objects.get('m1/progress/state'));assert.ok(s.nextAt>=retryAt);s.lastAttempt=0;objects.set('m1/progress/state',JSON.stringify(s));const before=calls;
 assert.ok((await syncProgress(env,true,async()=>{calls++;return {data:[]};},async()=>'test')).retryAfterMs>0);assert.equal(calls,before);db.close();
});
