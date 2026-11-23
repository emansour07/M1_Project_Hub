import {companyForAsset} from './company-core.mjs';
const parcelNames={'102':'102 — Island','121':'121 — Mainland'};
export function enrichMidpEntries(entries,scope,settings){
 const assets=new Map((scope?.rows||[]).map(a=>[a.id,a]));
 return entries.map(row=>{
  const asset=assets.get(row.scopeId),written=String(row.name||'').split('-')[1]?.trim().toUpperCase()||'',zone=asset?.zone||'',scopeParcel={Island:'102',Mainland:'121'}[zone];
  const actualParcel=scopeParcel||(['102','121'].includes(written)?written:'Unconfirmed');
  const parcelEvidence=scopeParcel?'Scoped asset: '+asset.code+' · '+zone:actualParcel!=='Unconfirmed'?'Document number':'No confirmed parcel code in the asset reference';
  const company=asset?companyForAsset(asset,settings):null;
  return {...row,scopeResponsibility:(company?.appendixParty||asset?.appendixParty||asset?.party)==='ATM'?'ATM':'ARX',actualParcel,parcelLabel:parcelNames[actualParcel]||(zone?zone+' — parcel unconfirmed':'Parcel unconfirmed'),writtenParcel:written||'Not provided',parcelEvidence,parcelNeedsCorrection:!!scopeParcel&&written!==scopeParcel,actualOriginator:company?.party||'Not assigned',actualOriginatorColor:company?.color||null};
 });
}
