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
test('every TIDP row survives repeated names with its own dates and approval',()=>{
 const a=extractTidp(fixture(),source(),scope),b=extractTidp(fixture(),source('b'),scope);let m=mergeTidps([a,b]);assert.equal(m.total,2);assert.equal(m.duplicates,1);assert.equal(m.conflicts,0);
 const c=extractTidp(fixture({planned:'2026-11-19',approval:'rejected'}),source('c'),scope);m=mergeTidps([a,c]);assert.equal(m.conflicts,1);assert.deepEqual(m.entries.map(r=>r.plannedDate),['2026-11-16','2026-11-19']);assert.deepEqual(m.entries.map(r=>r.approvalStatus),['approved','rejected']);assert.equal(m.affectedDocuments,2);assert.equal(m.duplicateGroups,1);assert.equal(m.entries[0].origins.length,2);
});
test('merged workbook supports full and inclusive planned-date export with forecast and status',()=>{
 const r=extractTidp(fixture(),source(),scope),m=mergeTidps([r]);
 for(const range of [[null,null],['2026-11-16','2026-11-16']]){const out=exportTidps([r],m.entries,...range),wb=read(out.bytes,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];assert.equal(ws.BC4.v,'2026-11-16');assert.equal(ws.BD4.v,'2026-11-18');assert.equal(ws.BE4.v,'approved');assert(wb.Sheets['TIDP sources']);}
 assert.throws(()=>exportTidps([r],m.entries,'2026-11-17','2026-11-18'),/No deliverables/);assert.throws(()=>exportTidps([r],m.entries,'2026-11-17','2026-11-16'),/valid/);
});
test('batches publish only a complete consistent set and retain prior data after failure',async()=>{
 const objects=new Map([['m1/scope',JSON.stringify(scope)]]),env={BUCKET:{get:async k=>objects.has(k)?{json:async()=>JSON.parse(objects.get(k))}:null,put:async(k,v)=>objects.set(k,v)}};
 let version=1;const services={batchSize:1,list:async()=>[{id:'a',name:source().name,versionId:'a:'+version},{id:'b',name:source().name,versionId:'b:'+version}],download:async(_env,id)=>({source:source(id,version),bytes:fixture()})};
 await syncTidpBatch(env,true,services);assert.equal(await tidpSnapshot(env),null);await syncTidpBatch(env,true,services);assert.equal((await tidpSnapshot(env)).total,2);
 const published=(await tidpSnapshot(env)).generation;version=2;await syncTidpBatch(env,true,services);version=3;await assert.rejects(syncTidpBatch(env,true,services),/changed during/);assert.equal((await tidpSnapshot(env)).generation,published);
});

test('explicit formerly-code evidence in the TIDP introduction resolves renamed scoped assets',()=>{
 const wb=read(fixture(),{type:'array'});const ws=wb.Sheets.ARCH;ws.A4.v=ws.A4.v.replace('-SAP-A-','-SAP-NEW-');ws.R4.v='NEW';
 utils.book_append_sheet(wb,utils.aoa_to_sheet([['Asset / Building','NEW - Updated asset | Island (Formerly A)']]),'Introduction');
 const src={...source('new'),name:source().name.replace('-SAP-A-','-SAP-NEW-')};
 const r=extractTidp(write(wb,{type:'buffer',bookType:'xlsx'}),src,scope);
 assert.equal(r.scopeId,'Island-A');assert.equal(r.entries[0].scopeAsset,'NEW');assert.match(r.mappingEvidence,/Formerly A/);
});


test('row export keeps only matching dates and preserves identical duplicate rows',()=>{
 const a=extractTidp(fixture(),source(),scope),b=extractTidp(fixture({planned:'2026-11-19'}),source('b'),scope),m=mergeTidps([a,b]);
 const ranged=exportTidps([a,b],m.entries,'2026-11-19','2026-11-19'),book=read(ranged.bytes,{type:'array'});
 assert.equal(ranged.count,1);assert.equal(book.SheetNames.length,2);assert.equal(book.Sheets[book.SheetNames[0]].BC4.v,'2026-11-19');
 const same=extractTidp(fixture(),source('same'),scope),full=exportTidps([a,same],mergeTidps([a,same]).entries);
 assert.equal(full.count,2);assert.equal(read(full.bytes,{type:'array'}).SheetNames.length,3);
});

test('new TIDP versions remove duplicate warnings after source correction',async()=>{
 const objects=new Map([['m1/scope',JSON.stringify(scope)]]),env={BUCKET:{get:async k=>objects.has(k)?{json:async()=>JSON.parse(objects.get(k))}:null,put:async(k,v)=>objects.set(k,v)}};
 let version=1;const services={list:async()=>['a','b'].map(id=>({id,name:source().name,versionId:id+':'+version})),download:async(_env,id)=>{let bytes=fixture();if(version===2&&id==='b'){const w=read(bytes,{type:'array'});w.Sheets.ARCH.A4.v=w.Sheets.ARCH.A4.v.replace('000001','000002');bytes=write(w,{type:'buffer',bookType:'xlsx'});}return {source:source(id,version),bytes};}};
 await syncTidpBatch(env,true,services);assert.equal((await tidpSnapshot(env)).affectedDocuments,2);
 version=2;await syncTidpBatch(env,true,services);const next=await tidpSnapshot(env);assert.equal(next.total,2);assert.equal(next.affectedDocuments,0);assert.equal(next.duplicateGroups,0);
});
