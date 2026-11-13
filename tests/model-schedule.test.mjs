import test from 'node:test';
import assert from 'node:assert/strict';
import {selectScan,scanDueAt,ensureModelAlarm,runModelAlarm} from '../model-schedule.mjs';
import {syncModelSources} from '../progress.mjs';
import {syncNextWorkbook} from '../workbook-schedule.mjs';

function bucket(){const rows=new Map();return {rows,async get(key){return rows.has(key)?{json:async()=>JSON.parse(rows.get(key))}:null;},async put(key,value){rows.set(key,value);}};}
test('reference and format batches alternate even while both large scans stay active',async()=>{
 const env={BUCKET:bucket()},calls=[];
 await env.BUCKET.put('m1/progress/state',JSON.stringify({active:true}));
 await env.BUCKET.put('m1/formats/state',JSON.stringify({active:true}));
 const run={progress:async(...args)=>{calls.push(['progress',args[4]]);throw Error('Provider temporarily unavailable');},formats:async(...args)=>calls.push(['formats',args[3]])};
 await assert.rejects(()=>syncModelSources(env,false,36,run));
 await syncModelSources(env,false,36,run);
 await assert.rejects(()=>syncModelSources(env,false,36,run));
 assert.deepEqual(calls,[['progress',36],['formats',36],['progress',36]]);
});
test('backoff, active leases and batch cooldowns do not block the other scan',()=>{
 const now=100000,states={progress:{active:true,batchNotBefore:now+10000},formats:{active:true}};
 assert.equal(selectScan(states,'formats',now),'formats');
 states.progress={active:false,lastAttempt:0,nextAt:now+300000,lastFailure:{status:429}};
 assert.equal(scanDueAt('progress',states.progress,now,true),now+300000);
 states.formats={active:true,leaseUntil:now+120000};
 assert.equal(selectScan(states,'formats',now,true),null);
 assert.equal(selectScan({progress:{},formats:{}},null,now),'progress');
});
test('automatic wakes continue without viewers and honour provider retry times',async()=>{
 let alarm=null;const writes=[],storage={getAlarm:async()=>alarm,setAlarm:async t=>{alarm=t;writes.push(t);}};
 await ensureModelAlarm(storage,false,100);assert.equal(alarm,null);
 await ensureModelAlarm(storage,true,100);assert.equal(alarm,1100);
 await ensureModelAlarm(storage,true,500);assert.equal(writes.length,1);
 const retry=Date.now()+300000;
 await runModelAlarm(storage,true,async()=>{throw Error('Rate limited');},async()=>retry);
 assert.equal(alarm,retry);
 const n=writes.length;await runModelAlarm(storage,false,()=>assert.fail(),()=>assert.fail());assert.equal(writes.length,n);
});
test('a failing workbook cannot starve other stale Excel sources',async()=>{
 const env={BUCKET:bucket()},calls=[],read=async()=>null,sync=async(_env,key)=>{calls.push(key);if(key==='scope')throw Error('Source unavailable');return {};};
 await assert.rejects(()=>syncNextWorkbook(env,read,sync));
 for(let i=0;i<3;i++)await syncNextWorkbook(env,read,sync);
 assert.deepEqual(calls,['scope','tidp','tracker','midp']);
 assert.deepEqual(await syncNextWorkbook(env,async()=>({source:{checkedAt:Date.now()}}),()=>assert.fail()),{skipped:true});
});
