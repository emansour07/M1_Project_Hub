import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {syncProgress,progressSnapshot} from '../progress.mjs';import {sources} from '../sources.mjs';
function environment(){const db=new DatabaseSync(':memory:'),objects=new Map();const env={ACC_PROJECT_ID:'test',SQL:{exec(query,...args){const stmt=db.prepare(query);const rows=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>rows};}},BUCKET:{async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},async put(key,value){objects.set(key,value);return {etag:'x'};}}};objects.set('m1/workbooks/tidp',JSON.stringify({rows:[{existing:'A48',proposed:'CRA'}]}));objects.set('m1/workbooks/tracker',JSON.stringify({rows:[]}));return {env,objects,db};}
const folder=(id,name)=>({id,type:'folders',attributes:{name}});
test('large scans resume across bounded invocations and publish only after completion',async()=>{
 const {env,db}=environment();let calls=0;
 const read=async path=>{calls++;const id=decodeURIComponent(path.split('/folders/')[1].split('/contents')[0]);return {data:id===sources.reference?[folder('island','Island'),folder('mainland','Mainland'),folder('subsea','Subsea'),folder('excluded','Other Assets')]:id===sources.progress1?Array.from({length:25},(_,i)=>folder('p'+i,'models'+i)):[]};};
 assert.equal((await syncProgress(env,true,read,async()=>'test')).updating,true);assert.equal(calls,18);assert.equal((await progressSnapshot(env)).scan,null);
 assert.equal((await syncProgress(env,true,read,async()=>'test')).ok,true);assert.equal((await progressSnapshot(env)).scan.complete,true);assert.equal(db.prepare("SELECT COUNT(*) n FROM progress_queue WHERE task LIKE '%excluded%'").get().n,0);db.close();
});
test('permission failure retains the last complete generation',async()=>{
 const {env,objects,db}=environment();objects.set('m1/progress/state',JSON.stringify({published:'last',checkedAt:123,lastAttempt:0}));
 await assert.rejects(()=>syncProgress(env,true,async()=>{throw Error('Forbidden');},async()=>'test'));
 const s=JSON.parse(objects.get('m1/progress/state'));assert.equal(s.published,'last');assert.equal(s.checkedAt,123);assert.equal(s.active,false);db.close();
});
