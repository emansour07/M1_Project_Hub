// Transcribed from the user's Appendix 1 — Division of Scope (M1.png, page 5).
// Blank source codes stay blank. Interface assets do not expand the delivery baseline.
const entries=[
 ['Mainland','','SWRO Plant','ATM'],
 ['Mainland','SP','Stormwater Overflow Pond','ARX'],
 ['Mainland','WT1','Mainland & Island Transfer Water Tank Phase 1','ARX'],
 ['Mainland','WT2','Island Transfer Water Tank Phase 2','ARX'],
 ['Mainland','SG2','MV Switchgear Building','ATM'],
 ['Mainland','WP1','Water & Firewater Pump Station Building','ARX'],
 ['Mainland','G03','Outdoor Generator Plant','ATM'],
 ['Mainland','SL1','Stormwater Lift Pump Stations Building','ARX'],
 ['Mainland','SL2','Stormwater Lift Pump Stations Building','ARX'],
 ['Mainland','FP1','Fire Water Tank & Pump Room','ARX'],
 ['Mainland','VS1','Sewage Vacuum Station','ARX'],
 ['Mainland','DI1','Disinfection Building','ARX'],
 ['Mainland','','Seawater intakes and outfalls (SWRO)','ATM'],
 ['Mainland','','External Works - Site Clearance, Earthworks & Grading','ATM'],
 ['Mainland','','External Works - Roads, Fencing, Gates','ARX'],
 ['Mainland','','External Works - Softscape / Hardscape','ARX'],
 ['Mainland','','External Works - Service and utilities','ARX'],
 ['Mainland','PSS2','Primary Substation 2','ARX/ATM (Interfacing Only)'],
 ['Island','DC1','District Cooling Plant','ARX'],
 ['Island','G01','Generator Farm Phase 1 Building','ATM'],
 ['Island','ST1','Sewage Treatment Plant','ARX'],
 ['Island','SG1','MV Switchgear Building','ATM'],
 ['Island','G02','Generator Farm Phase 2 Building','ATM'],
 ['Island','A55','2-Day Parcel Water Tank & Pump Room','ARX'],
 ['Island','DT1','Underground Diesel Fuel Tank Farm','ATM'],
 ['Island','A33','Utility Staff Accommodation Building','ARX'],
 ['Island','A36','Utility Staff Accommodation Building','ARX'],
 ['Island','A37','Utility Staff Accommodation Building','ARX'],
 ['Island','A51','Electrical Substation','ATM'],
 ['Island','A52','Electrical Substation','ATM'],
 ['Island','A57','Water Tank & Pump Room','ARX'],
 ['Island','A48','Gatehouse / Control Room','ARX'],
 ['Island','C48','Gatehouse / Control Room','ARX'],
 ['Island','D48','Gatehouse / Control Room','ARX'],
 ['Island','E48','Gatehouse / Control Room','ARX'],
 ['Island','','External Works - Site Clearance, Earthworks & Grading','ATM'],
 ['Island','','External Works - Roads, Fencing, Gates','ARX'],
 ['Island','','External Works - Softscape / Hardscape','ARX'],
 ['Island','','External Works - Service and utilities','ARX'],
 ['Island','I01','Combined Water Tank & Pump Station','ARX/ATM (Interfacing Only)'],
 ['Island','DX1','Data centre security','ARX/ATM (Interfacing Only)'],
 ['Island','DX2','Data centre ICT','ARX/ATM (Interfacing Only)'],
 ['Island','PSS1','Primary Substation 1','ARX/ATM (Interfacing Only)'],
 ['Subsea','SS1 & SS2','Subsea Water Transmission Pipelines (2No)','ATM']
];
// User-confirmed delivery assignment, clarified to include all four gatehouses.
// Appendix responsibility remains ARX; Z-Dizayn supplies modelling, not design.
export const zDizaynAssets=['A33','A36','A37','A48','C48','D48','E48'];
export const divisionScope=entries.map(([zone,code,name,party],i)=>({id:'scope-'+(i+1),zone,code,name,party,interfaceOnly:party.includes('Interfacing'),...(zone==='Island'&&zDizaynAssets.includes(code)?{appendixParty:party,party:'Z-Dizayn',deliveryRole:'Modelling based on supplied design information'}:{})}));
export function responsibilityFor(asset){
 return divisionScope.find(r=>r.zone===asset.zone&&r.code&&r.code===asset.code)||divisionScope.find(r=>r.zone===asset.zone&&r.name.toLowerCase()===asset.name?.toLowerCase())||null;
}
