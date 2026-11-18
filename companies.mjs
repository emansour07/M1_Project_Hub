import defaults from './company/hub/company-defaults.json' with {type:'json'};
export const defaultCompanies=()=>structuredClone(defaults);
export function applyCompanyUpdates(current){
 const marker='arx-egy-2026-11-18';if(current.appliedUpdates?.includes(marker))return current;
 const next=structuredClone(current),seed=defaultCompanies(),existing=next.companies.find(c=>c.name.toLowerCase()==='arx egy');
 const company=existing||seed.companies.find(c=>c.id==='arx-egy');if(!existing){if(next.companies.some(c=>c.id===company.id))company.id+='-20261118';next.companies.push(company);}
 const additions=seed.assignments.filter(a=>a.companyId==='arx-egy').map(a=>({...a,companyId:company.id}));
 next.assignments=next.assignments.filter(a=>!additions.some(b=>b.assetId===a.assetId)).concat(additions);
 next.appliedUpdates=[...(current.appliedUpdates||[]),marker];next.revision++;return next;
}
export async function companySettings(env){
 for(let retry=0;retry<3;retry++){const old=await env.BUCKET.get('m1/companies'),current=old?await old.json():defaultCompanies(),next=applyCompanyUpdates(current);if(next===current)return current;
 if(await env.BUCKET.put('m1/companies',JSON.stringify(next),{onlyIf:old?{etagMatches:old.etag}:new Headers({'If-None-Match':'*'})}))return next;}
 throw Error('Company settings changed. Reload before saving.');
}
export function validateCompanies(p,assets){
 if(!p||!Number.isInteger(p.revision)||p.revision<0||!Array.isArray(p.companies)||!p.companies.length||p.companies.length>100||!Array.isArray(p.assignments)||p.assignments.length>500)throw Error('Check the company settings.');
 const ids=new Set(),names=new Set(),seen=new Set(),valid=new Set(assets.map(a=>a.id));
 const companies=p.companies.map(c=>{if(!c||typeof c.id!=='string'||!/^[-a-z0-9]{1,64}$/.test(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>100||typeof c.color!=='string'||!/^#[a-f0-9]{6}$/i.test(c.color)||ids.has(c.id)||names.has(c.name.trim().toLowerCase()))throw Error('Each company needs a unique name and a valid colour.');ids.add(c.id);names.add(c.name.trim().toLowerCase());return {id:c.id,name:c.name.trim(),color:c.color.toLowerCase()};});
 const assignments=p.assignments.map(a=>{if(!a||!valid.has(a.assetId)||seen.has(a.assetId)||!ids.has(a.companyId)||typeof a.role!=='string'||a.role.length>250)throw Error('Choose an in-scope asset and an existing company.');if(a.reportedStatus!==undefined&&!['','Running','Not started yet','Finished','On hold'].includes(a.reportedStatus))throw Error('Choose a valid reported asset status.');seen.add(a.assetId);return {assetId:a.assetId,companyId:a.companyId,role:a.role.trim(),...(a.reportedStatus?{reportedStatus:a.reportedStatus}:{})};});
 return {revision:p.revision+1,companies,assignments};
}
export async function saveCompanies(env,p,assets){await companySettings(env);const old=await env.BUCKET.get('m1/companies'),current=old?await old.json():defaultCompanies();if(p.revision!==current.revision)throw Error('Company settings changed. Reload before saving.');const next={...validateCompanies(p,assets),appliedUpdates:current.appliedUpdates||[]};if(!await env.BUCKET.put('m1/companies',JSON.stringify(next),{onlyIf:old?{etagMatches:old.etag}:new Headers({'If-None-Match':'*'})}))throw Error('Company settings changed. Reload before saving.');return next;}
