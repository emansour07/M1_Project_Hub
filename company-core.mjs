import {responsibilityFor} from './division-scope.mjs';
export function companyForAsset(asset,settings){
 const source=responsibilityFor(asset)||asset,original=source.appendixParty||source.party||'To confirm';
 if(!settings)return {party:source.party||original,appendixParty:source.appendixParty,deliveryRole:source.deliveryRole};
 const originalId={'ARX':'arx','ATM':'atm','ARX/ATM (Interfacing Only)':'interface'}[original];
 const assignment=settings.assignments.find(a=>a.assetId===(asset.assetId||asset.id)),company=settings.companies.find(c=>assignment?c.id===assignment.companyId:originalId?c.id===originalId:c.name===original);
 return {party:company?.name||original,color:/^#[a-f0-9]{6}$/i.test(company?.color||'')?company.color:null,appendixParty:original,deliveryRole:assignment?.role||''};
}
