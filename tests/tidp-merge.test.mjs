import test from 'node:test';
import assert from 'node:assert/strict';
import {utils,write,read} from 'xlsx';
import {extractTidp,mergeTidps,exportTidps,sourceScope} from '../tidp-merge.mjs';
import {syncTidpBatch,tidpSnapshot} from '../tidp-sync.mjs';
const scope={revision:1,rows:[{id:'Island-A',code:'A',name:'Asset A',zone:'Island',aliases:['A'],ambiguous:[],proposed:'A',filename:'M1-FXX-SAP-A-05-LD000-LOD-XX-000001-R01_TIDP_A.xlsx'}]};
const source=(id='a',version=1)=>({itemId:id,version,versionId:id+':'+version,name:scope.rows[0].filename,checkedAt:Date.now()});
function fixture({planned='2026-11-16',approval='approved',outside=false}={}){
 const head=[];head[0]='DELIVERABLE (TITLE)';head[1]='DESCRIPTION';head[27]='Issue Date';head[54]='Planned Date';head[55]='Forecast Date';head[56]='MACE_ACC_Status';
 const fmt=[];fmt[2]='.rvt';fmt[3]='.nwc';const row=[];row[0]='M1-FXX-SAP-A-05-BM010-BNM-XX-000001-R00';row[1]='Model';row[2]='Yes';row[3]='Yes';row[17]='A';row[54]=planned;row[55]='2026-11-18';row[56]=approval;
 const rows=[head,fmt,['BIM Models'],row];if(outside)rows.push(['M1-FXX-SAP-OTHER-05-BM010-BNM-XX-000001-R00','Outside scope']);
 const wb=utils.book_new();utils.book_append_sheet(wb,utils.aoa_to_sheet(rows),'ARCH');return write(wb,{type:'buffer',bookType:'xlsx'});
}
test('TIDP merge reads schedules, status and provenance, retains only scoped rows',()=>{
 const r=extractTidp(fixture({outside:true}),source(),scope);assert.equal(r.entries.length,1);assert.equal(r.entries[0].plannedDate,'2026-11-16');assert.equal(r.entries[0].forecastDate,'2026-11-18');assert.equal(r.entries[0].approvalStatus,'approved');assert.match(r.entries[0].sourceUrl,/entityId=a/);assert(!r.sheets[0].xml.includes('Outside scope'));
 assert.equal(sourceScope('M1-FXX-SAP-OTHER-05-LD000-LOD-XX-000001_TIDP_OTHER.xlsx',scope),null);
});
test('identical duplicate names count once and conflicting approval/date is not guessed',()=>{
 const a=extractTidp(fixture(),source(),scope),b=extractTidp(fixture(),source('b'),scope);let m=mergeTidps([a,b]);assert.equal(m.total,1);assert.equal(m.duplicates,1);assert.equal(m.conflicts,0);
 const c=extractTidp(fixture({planned:'2026-11-19',approval:'rejected'}),source('c'),scope);m=mergeTidps([a,c]);assert.equal(m.conflicts,1);assert.equal(m.entries[0].plannedDate,null);assert.equal(m.entries[0].approvalStatus,'');assert.equal(m.entries[0].origins.length,2);
});
test('merged workbook supports full and inclusive planned-date export with forecast and status',()=>{
 const r=extractTidp(fixture(),source(),scope),m=mergeTidps([r]);
 for(const range of [[null,null],['2026-11-16','2026-11-16']]){const out=exportTidps([r],m.entries,...range),wb=read(out.bytes,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];assert.equal(ws.BC4.v,'2026-11-16');assert.equal(ws.BD4.v,'2026-11-18');assert.equal(ws.BE4.v,'approved');assert(wb.Sheets['TIDP sources']);}
 assert.throws(()=>exportTidps([r],m.entries,'2026-11-17','2026-11-18'),/No deliverables/);assert.throws(()=>exportTidps([r],m.entries,'2026-11-17','2026-11-16'),/valid/);
});
test('batches publish only a complete consistent set and retain prior data after failure',async()=>{
 const objects=new Map([['m1/scope',JSON.stringify(scope)]]),env={BUCKET:{get:async k=>objects.has(k)?{json:async()=>JSON.parse(objects.get(k))}:null,put:async(k,v)=>objects.set(k,v)}};
 let version=1;const services={batchSize:1,list:async()=>[{id:'a',name:source().name,versionId:'a:'+version},{id:'b',name:source().name,versionId:'b:'+version}],download:async(_env,id)=>({source:source(id,version),bytes:fixture()})};
 await syncTidpBatch(env,true,services);assert.equal(await tidpSnapshot(env),null);await syncTidpBatch(env,true,services);assert.equal((await tidpSnapshot(env)).total,1);
 const published=(await tidpSnapshot(env)).generation;version=2;await syncTidpBatch(env,true,services);version=3;await assert.rejects(syncTidpBatch(env,true,services),/changed during/);assert.equal((await tidpSnapshot(env)).generation,published);
});
