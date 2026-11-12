const text=v=>String(v??'').trim();
export function parseNamingRules(rows){
 const labels=['Parcel','Originator','Project stage','Package / discipline','Document type','Level'],indices=[1,4,7,10,13,16],fields=[1,2,4,5,6,7];
 if(!/Project.*Parcel/i.test(text(rows[0]?.[0]))||text(rows[1]?.[1]).toUpperCase()!=='CODE')throw Error('TIDP naming picklist layout changed.');
 return {fields:indices.map((column,i)=>({index:fields[i],label:labels[i],values:rows.slice(2).flatMap(r=>{const code=text(r[column]);return /^[A-Z0-9]+$/.test(code)?[{code,description:text(r[column-1])}]:[]})})),pattern:'Project-Parcel-Originator-Asset-Stage-Package-Type-Level-Number[-Revision]'};
}
export function checkName(name,mapping,rules){
 if(!mapping?.length||!rules?.fields?.length)return {state:'unchecked',issues:[],suggestion:null};
 const original=text(name),ext=/\.([a-z0-9]+)$/i.exec(original),stem=ext?original.slice(0,-ext[0].length):original,parts=stem.split('-'),issues=[],fixed=[...parts];
 const add=(field,message,corrected=null)=>issues.push({field,message,corrected});
 if(!ext)add('Extension','File extension is missing.');
 if(parts.length!==9&&parts.length!==10){add('Structure','Use '+rules.pattern+'.');return {state:'warning',issues,suggestion:null};}
 for(let i=0;i<parts.length;i++)if(parts[i]!==parts[i].toUpperCase()){fixed[i]=parts[i].toUpperCase();add('Case','Use uppercase naming codes.',fixed[i]);}
 if(fixed[0]!=='M1'){fixed[0]='M1';add('Project','Project code must be M1.','M1');}
 for(const field of rules.fields)if(!field.values.some(v=>v.code===fixed[field.index]))add(field.label,'“'+fixed[field.index]+'” is not in the TIDP '+field.label.toLowerCase()+' picklist.');
 const asset=fixed[3],parcel=fixed[1],numeric=/^\d{2,3}$/.test(parcel),scoped=numeric?mapping.filter(r=>Number(String(r.section||'').replace('.',''))===Number(parcel)):mapping;
 // Already-proposed codes take precedence over legacy codes with the same text.
 if(!['XXX','YYY','ZZZ'].includes(asset)&&!scoped.some(r=>r.proposed===asset)){
  const candidates=[...new Set(scoped.filter(r=>r.existing===asset).map(r=>r.proposed))];
  if(candidates.length===1){fixed[3]=candidates[0];add('Asset','Replace existing asset code '+asset+' with proposed code '+candidates[0]+'.',candidates[0]);}
  else add('Asset',candidates.length?'Asset '+asset+' has multiple proposed codes: '+candidates.join(', ')+'. Confirm the section.':'Asset '+asset+' is not a proposed code for this parcel in the TIDP.');
 }
 if(!/^\d{6}$/.test(fixed[8]))add('Number','Document number must have six digits, as used in the TIDP filename.');
 if(parts.length===10&&!/^R\d{2}$/.test(fixed[9]))add('Revision','Use an R followed by two digits, as used in the TIDP filename; confirm the actual revision.');
 return {state:issues.length?'warning':'pass',issues,suggestion:issues.length&&issues.every(i=>i.corrected)&&ext?fixed.join('-')+ext[0]:null};
}
