import {deliverableStage} from './delivery-core.mjs';
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function deliverySummary(rows){
 const counts=key=>Object.entries(rows.reduce((out,r)=>{const v=key(r);out[v]=(out[v]||0)+1;return out;},{})).map(([name,qty])=>({name,qty}));
 const daily=new Map();let planned=0,forecast=0;
 for(const r of rows)for(const [field,key] of [['plannedDate','planned'],['forecastDate','forecast']])if(validDate(r[field])){const d=r[field];if(!daily.has(d))daily.set(d,{date:d,planned:0,forecast:0});daily.get(d)[key]++;if(key==='planned')planned++;else forecast++;}
 let p=0,f=0;const curve=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,plannedTotal:p+=d.planned,forecastTotal:f+=d.forecast}));
 return {total:rows.length,planned,forecast,undated:rows.length-planned,curve,stages:counts(deliverableStage).sort((a,b)=>a.name.localeCompare(b.name)),disciplines:counts(r=>r.discipline||'Unclassified').sort((a,b)=>b.qty-a.qty),responsibility:counts(r=>r.scopeResponsibility||'ARX')};
}
