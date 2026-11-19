// Original-design evidence only. Never rewrite source filenames or workbooks.
export function excludedReceived(row){return String(row.name||'').toUpperCase().split('-')[3]==='A51'||row.scopeId==='Island-A51';}
export function receiptHint(row){
 const p=String(row.name||'').toUpperCase().split('-'),code=p[3],source=String(row.source||''),description=String(row.description||''),context=description+' '+source+' '+(row.folderPath||[]).join(' ');
 if(excludedReceived(row)||(/^\d{3}$/.test(p[1])&&!['102','121'].includes(p[1])))return null;
 const aliases={MW1:'Mainland-WT1',MW2:'Mainland-WT2',SWP:'Mainland-SP',TP1:'Subsea-SS1',TP2:'Subsea-SS2'};
 if(aliases[code]){const zone=aliases[code].split('-')[0];if((p[1]==='102'&&zone!=='Island')||(p[1]==='121'&&zone!=='Mainland'))return null;return {id:aliases[code],evidence:'Original code '+code+'; source TIDP / asset description'};}
 const zone=p[1]==='102'?'Island':p[1]==='121'?'Mainland':/\bMainland\b|\b121[- ]/.test(context)?'Mainland':/\bIsland\b|\b102[- ]/.test(context)?'Island':null;
 if(!zone)return null;
 if(code==='TRF'&&p[5]==='BM015')return {id:zone+'-EW-ROD',evidence:'Parcel and Roads / Traffic model code BM015'};
 if(!['XXX','YYY','ZZZ'].includes(code))return null;
 let category=null;
 if(/EARTHWORK|GRADING|SITE.CLEARANCE/i.test(context))category='EW-GRD';
 else if(/ROADS?|FENCING|TRAFFIC/i.test(context))category='EW-ROD';
 else if(/SOFTSCAPE|HARDSCAPE|LANDSCAPE/i.test(context))category='EW-LAN';
 else if(/UTILIT|SEWAGE.?NETWORK|STORM.?NETWORK/i.test(context)||p[5]==='BM037')category='EW-UTL';
 return category?{id:zone+'-'+category,evidence:'Parcel / area and original model description or utility code'}:null;
}

// Owner approved 19 Nov: keep this parcel federation separate from asset totals.
export function coordinationAsset(row){
 if(/^M1-121-PAR-P02-42-(?:BM012-B(?:NM\/BGM|NM|GM)-ZZ-901001|BM019-B(?:NM\/BGM|NM|GM)-ZZ-900001|BM036-B(?:NM\/BGM|NM|GM)-ZZ-901001)(?:-R\d+)?(?:\.(?:RVT|DWG|NWC|IFC|DWFX))?$/i.test(row.name||''))return {id:'Mainland-SL1-SL2',code:'SL1 + SL2',name:'SL1 + SL2 station complex',zone:'Mainland',sharedAssets:['Mainland-SL1','Mainland-SL2'],assignmentEvidence:'Owner-confirmed shared SL1 + SL2 group. Source IFC content spans the station complex; each model is counted once.'};
 const base=String(row.name||'').toUpperCase().replace(/\.(RVT|DWG|NWC|IFC|DWFX)$/,'').replace(/-R\d+$/,'');
 return base==='M1-102-HES-XXX-42-BM100-BFM-XX-900001'?{id:'Island-wide',code:'Island-wide',name:'Island-wide coordination',zone:'Island',areaWide:true,assignmentEvidence:'Parcel 10.2 federation; owner-confirmed area-wide classification'}:null;
}

export function receiptContentMetadata(row){
 if(/^M1-121-PAR-XXX-42-BM036-B(?:NM\/BGM|NM|GM)-ZZ-901002(?:-|\.|$)/i.test(row.name||''))return {assignmentComment:'Asset confirmation required: the IFC building is named WATER PUMP STATION, but does not identify WP1, WT1 or WT2. The similarly numbered P01 model is a different file named MAINLAND CAMP. Kept pending at the owner’s request.'};
 return /^M1-102-HES-XXX-42-BM046-B(?:NM\/BGM|NM|GM)-MP-90100[012](?:-|\.|$)/i.test(row.name)?{discipline:'Sewage (Wet Utilities)',contentEvidence:'Source IFC project and building: Sewage P10.2 NEW; BM046 picklist conflicts with model content'}:{};
}
