import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {parseScope,scopePolicy,scopeMatch,scopedFile,scopedReview} from '../scope.mjs';
import {issueDate,parseMidpDeliverables,inDateRange,dateRange,filterMidpWorkbook} from '../midp.mjs';
const scopeRows=[{id:'Island-A48',code:'A48',name:'Control room',zone:'Island',parcel:'102',aliases:['A48']},{id:'Mainland-WT2',code:'WT2',name:'Water tank',zone:'Mainland',parcel:'121',aliases:['WT2','W02']}];
const mapping=[{section:'10.2',existing:'A48',proposed:'CRA',name:'Control room'},{section:'12.1',existing:'A48',proposed:'GS5',name:'Other building'},{section:'12.1',existing:'A01',proposed:'GS1',name:'Outside scope'}];
test('scope uses exact codes and zones and does not widen a reused legacy code',()=>{
 const p=scopePolicy(scopeRows,mapping);
 assert.equal(scopeMatch({name:'M1-102-SAP-A48-05-BM010-BNM-XX-000001.rvt'},p)?.id,'Island-A48');
 assert.equal(scopeMatch({name:'M1-FXX-SAP-CRA-05-BM010-BNM-XX-000001.rvt'},p)?.id,'Island-A48');
 assert.equal(scopeMatch({name:'M1-121-SAP-A48-05-BM010-BNM-XX-000001.rvt'},p),null);
 assert.equal(scopeMatch({name:'M1-FXX-SAP-A48-05-BM010-BNM-XX-000001.rvt'},p),null);
 assert.equal(scopeMatch({name:'M1-102-SAP-A480-05-BM010-BNM-XX-000001.rvt'},p),null);
 assert.equal(scopeMatch({name:'M1-121-SAP-GS1-05-BM010-BNM-XX-000001.rvt',folderPath:['A48']},p),null);
 assert.equal(scopedFile({name:'M1-121-SAP-W02-05-BM010-BNM-XX-000001.rvt'},p)?.scopeId,'Mainland-WT2');
});
test('scope parser retains only required columns, never local paths or processing notes',()=>{
 const r=parseScope([['Scope ID','Scope code','Asset','Zone','Party','Corrected filename','Original main-folder workbook','Action'],['Mainland-WT2','WT2','Tank','Mainland','ARX','M1-121-ARX-WT2-05-LD000-LOD-XX-000001.xlsx','C:\\private\\M1-121-ARX-W02-05-LD000-LOD-XX-000001.xlsx','private notes']]);
 assert.deepEqual(r[0].aliases,['WT2','W02']);assert.ok(!JSON.stringify(r).includes('private'));
});
test('reviews remove excluded documents and fully excluded workflows',()=>{
 const p=scopePolicy(scopeRows,mapping),inside={name:'M1-102-SAP-A48-05-BM010-BNM-XX-000001.rvt'},outside={name:'M1-121-SAP-GS1-05-BM010-BNM-XX-000001.rvt'};
 assert.equal(scopedReview({name:'Package',files:[inside,outside]},p).files.length,1);
 assert.equal(scopedReview({name:'Package',files:[outside]},p),null);
});
test('MIDP chooses the latest valid date across exchanges and treats blanks as undated',()=>{
 const rows=[['Title',null,'Issue Date',null,'Issue Date'],['DISCIPLINE: ARCH'],['M1-FXX-ARX-CRA-05-BM010-BNM-XX-000001','Model','12/11/2026',null,'2026-11-10'],['M1-FXX-ARX-CRA-05-BM010-BNM-XX-000002','Model','\u00a0',null,'31/02/2026']];
 const [a,b]=parseMidpDeliverables(rows,'CRA');assert.equal(a.latestIssueDate,'2026-11-12');assert.equal(a.latestExchange,1);assert.equal(b.latestIssueDate,null);assert.equal(b.invalidDateCells,1);
 assert.equal(inDateRange(a,'2026-11-12','2026-11-12'),false);assert.equal(inDateRange(b,'2026-01-01','2027-01-01'),false);assert.throws(()=>dateRange('2026-02-30','2026-11-12'));assert.throws(()=>dateRange('2026-11-13','2026-11-12'));assert.equal(issueDate(46338),'2026-11-12');
});
test('MIDP export physically removes excluded deliverables and sheets while retaining selected cell styles and layout',()=>{
 const files={
 'xl/workbook.xml':'<workbook><sheets><sheet name="CRA" sheetId="1" r:id="r1"/><sheet name="OUTSIDE" sheetId="2" r:id="r2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<worksheet><cols><col min="1" max="2" width="30"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="10" ht="34"><c r="A10" s="23" t="s"><v>1</v></c></row><row r="11"><c r="A11" t="s"><v>2</v></c><c r="B11"><v>123456</v></c></row></sheetData></worksheet>',
 'xl/worksheets/sheet2.xml':'<worksheet>OUTSIDE SECRET</worksheet>',
 'xl/styles.xml':'<styleSheet>preserve-style-table</styleSheet>',
 'xl/sharedStrings.xml':'<sst><si><t>Title</t></si><si><t>M1-FXX-ARX-CRA-05-BM010-BNM-XX-000001</t></si><si><t>M1-FXX-ARX-GS1-05-BM010-BNM-XX-000002</t></si><si><t>OUTSIDE SECRET</t></si></sst>'};
 const bytes=zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))),out=filterMidpWorkbook(bytes,[{sheet:'CRA',row:10,plannedDate:'2026-11-12'}],'2026-11-12','2026-11-12'),parts=unzipSync(out.bytes),all=Object.values(parts).map(strFromU8).join('');
 assert.equal(out.count,1);assert.equal(parts['xl/worksheets/sheet2.xml'],undefined);assert.ok(!all.includes('GS1'));assert.ok(!all.includes('OUTSIDE SECRET'));assert.ok(!all.includes('123456'));assert.equal(strFromU8(parts['xl/styles.xml']),files['xl/styles.xml']);assert.match(strFromU8(parts['xl/worksheets/sheet1.xml']),/ht="34"/);assert.match(all,/s="23"/);assert.match(all,/width="30"/);
});

test('MIDP uses named planned and forecast columns, never issue date as an export fallback',()=>{const rows=[['Title','Description','Issue Date','Planned Submission Date','Forecast Date'],['M1-FXX-SAP-CRA-05-BM010-BNM-XX-000001','Model','2026-12-01','2026-11-13',46340],['M1-FXX-SAP-CRA-05-BM010-BNM-XX-000002','Model','2026-11-13','','2026-11-14']];const [a,b]=parseMidpDeliverables(rows,'CRA');assert.equal(a.plannedDate,'2026-11-13');assert.equal(a.forecastDate,'2026-11-14');assert.equal(inDateRange(a,'2026-11-13','2026-11-13'),true);assert.equal(inDateRange(a,'2026-12-01','2026-12-01'),false);assert.equal(inDateRange(b,'2026-11-13','2026-11-14'),false);assert.equal(b.forecastDate,'2026-11-14');});
