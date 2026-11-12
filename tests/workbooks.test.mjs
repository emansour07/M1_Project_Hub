import test from 'node:test';import assert from 'node:assert/strict';
import {parseAssetRows,parseTrackerRows,parseMidpRows,percentage} from '../workbooks.mjs';
import {resolveAsset,assetFromFilename,canonicalFilename} from '../asset-codes.mjs';
const mapping=[{existing:'A48',proposed:'CRA'},{existing:'BT3',proposed:'B01'},{existing:'BT3',proposed:'B02'}];
test('old and proposed codes resolve to one asset without substring matches',()=>{
 assert.equal(resolveAsset('a48',mapping).code,'CRA');assert.equal(resolveAsset('CRA',mapping).code,'CRA');
 assert.equal(resolveAsset('A4',mapping).code,null);assert.equal(assetFromFilename('M1-102-PAR-A48-05-BM012-BNM-XX-000001.rvt',mapping).code,'CRA');
 assert.equal(canonicalFilename('M1-102-PAR-A48-05-BM012-BNM-XX-000001-R02.rvt',mapping),'M1-102-PAR-CRA-05-BM012-BNM-XX-000001');
});
test('reused codes stay ambiguous and unknown codes remain unmapped',()=>{
 assert.deepEqual(resolveAsset('BT3',mapping),{code:null,candidates:['B01','B02']});assert.equal(resolveAsset('XYZ',mapping).code,null);
});
test('parcel scopes reused legacy codes to the correct section',()=>{
 const rows=[{section:'10.2',existing:'A48',proposed:'CRA'},{section:'12.1',existing:'A48',proposed:'GS5'}];
 assert.equal(assetFromFilename('M1-102-PAR-A48-05-BM012-BNM-XX-000001.rvt',rows).code,'CRA');
 assert.equal(assetFromFilename('M1-121-PAR-A48-05-BM012-BNM-XX-000001.rvt',rows).code,'GS5');
 assert.equal(assetFromFilename('M1-FXX-PAR-A48-05-BM012-BNM-XX-000001.rvt',rows).code,null);
 assert.equal(assetFromFilename('M1-FXX-PAR-A48-05-BM012-BNM-XX-000001.rvt',rows,'either','P10.2').code,'CRA');
});
test('mapping parser retains sections, missing old codes and multiple destinations',()=>{
 const rows=[['Primary'],[null,null,null,null,'Section / Existing','Description','Proposed'],[null,null,null,null,null,'1.1'],[null,null,null,null,'BT3','Buffer tank 1','B01'],[null,null,null,null,'BT3','Buffer tank 2','B02'],[null,null,null,null,null,'New asset','N01']];
 const r=parseAssetRows(rows);assert.equal(r.length,3);assert.equal(r[0].section,'1.1');assert.equal(r[2].existing,null);assert.equal(r[1].row,5);
 assert.throws(()=>parseAssetRows([['Wrong','columns']]));
});
test('LOG and LOI preserve zero and unknown separately',()=>{
 assert.equal(percentage(null),null);assert.equal(percentage('#N/A'),null);assert.equal(percentage(0),0);assert.equal(percentage(.8),80);assert.equal(percentage('10%'),10);assert.equal(percentage(101),null);
 const r=parseTrackerRows([['Name','Description','LOG %','LOI %','Parcel'],['M1-FXX-SAP-CRA-05-BM012-BNM-XX-000001','Structure',.8,0,'P10.2'],['M1-FXX-SAP-CRA-05-BM018-BNM-XX-000001','Mechanical',null,'#N/A','P10.2']]);
 assert.equal(r[0].log,80);assert.equal(r[0].loi,0);assert.equal(r[1].log,null);assert.equal(r[1].loi,null);
});
test('tracker ignores hidden historical LOG and LOI columns',()=>{
 const rows=[['Name','LOG %','LOI %','LOG %','LOI %'],['M1-FXX-SAP-CRA-05-BM012-BNM-XX-000001',null,null,.8,.1]];
 assert.throws(()=>parseTrackerRows(rows),/one visible/);
 const r=parseTrackerRows(rows,[1,2]);assert.equal(r[0].log,80);assert.equal(r[0].loi,10);
});
test('MIDP uses model sections and includes infrastructure CAD without counting drawings',()=>{
 const rows=[['DELIVERABLE','DESCRIPTION','.rvt','.dwg'],['DISCIPLINE: CVL'],['BIM Models'],['M1-121-PAR-ROD-05-RD608-C3D-04-1-R00','C3D MODEL',null,'Yes'],['DRAWINGS (CUT FROM MODEL)'],['M1-121-PAR-ROD-05-RD608-DWG-04-2-R00','PLAN',null,'Yes']];
 const r=parseMidpRows(rows,'121-ARX-Ext-Roads');assert.equal(r.length,1);assert.equal(r[0].disciplineCode,'CVL');assert.equal(r[0].sheet,'121-ARX-Ext-Roads');
});
test('FXX and numbered parcel filenames join only through a unique mapped asset section',()=>{
 const rows=[{section:'10.2',existing:'C48',proposed:'CRC'}];
 assert.equal(canonicalFilename('M1-FXX-SAP-CRC-05-BM010-BNM-XX-948011',rows),canonicalFilename('M1-102-SAP-C48-05-BM010-BNM-XX-948011.rvt',rows));
});
