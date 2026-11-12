import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {syncFormats,formatSnapshot} from '../format-audit.mjs';import {sources} from '../sources.mjs';
function environment(){const db=new DatabaseSync(':memory:'),objects=new Map();const env={ACC_PROJECT_ID:'test',SQL:{exec(query,...args){const stmt=db.prepare(query);const rows=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>rows};}},BUCKET:{async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},async put(key,value){objects.set(key,value);return {etag:'x'};}}};objects.set('m1/workbooks/tidp',JSON.stringify({rows:[{existing:'A48',proposed:'CRA'}]}));objects.set('m1/workbooks/tracker',JSON.stringify({rows:[]}));return {env,objects,db};}

const folder=(id,name)=>({id,type:'folders',attributes:{name}});
test('format audit only publishes complete folder trees and respects the request budget',async()=>{
 const {env,objects,db}=environment();let count=0;
 const read=async path=>{count++;const id=decodeURIComponent(path.split('/folders/')[1].split('/contents')[0]);return {data:id===sources.progress1?Array.from({length:25},(_,i)=>folder('audit'+i,'Model '+i)):[]};};
 assert.equal((await syncFormats(env,read,async()=>'test')).updating,true);assert.equal(count,18);assert.equal(await formatSnapshot(env),null);
 const state=JSON.parse(objects.get('m1/formats/state'));state.nextBatch=0;objects.set('m1/formats/state',JSON.stringify(state));
 assert.equal((await syncFormats(env,read,async()=>'test')).updating,false);assert.ok((await formatSnapshot(env)).checkedAt);db.close();
});
test('format audit retains a previous snapshot and honors Retry-After after errors',async()=>{
 const {env,objects,db}=environment();objects.set('m1/formats/state',JSON.stringify({published:'old',checkedAt:123}));let calls=0;const until=Date.now()+600000;
 await assert.rejects(()=>syncFormats(env,async()=>{calls++;const e=Error('Provider limit');e.retryAt=until;throw e;},async()=>'test'));
 assert.equal((await formatSnapshot(env)).checkedAt,123);const before=calls;await syncFormats(env,async()=>{calls++;return {data:[]};},async()=>'test');assert.equal(calls,before);assert.ok(JSON.parse(objects.get('m1/formats/state')).nextBatch>=until);db.close();
});
