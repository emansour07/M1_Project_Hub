import {deliverableStage} from './delivery-core.mjs';
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function deliverySummary(rows,asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 const counts=key=>Object.entries(rows.reduce((out,r)=>{const v=key(r);out[v]=(out[v]||0)+1;return out;},{})).map(([name,qty])=>({name,qty}));
 const daily=new Map();let planned=0,actual=0,arxSapac=0,sapacMace=0;
 for(const r of rows)for(const [field,key] of [['plannedDate','planned'],['arxSapacDate','arxSapac'],['sapacMaceDate','sapacMace']])if(validDate(r[field])&&(key==='planned'||r[field]<=asOf)){const d=r[field];if(!daily.has(d))daily.set(d,{date:d,planned:0,actual:0,arxSapac:0,sapacMace:0});daily.get(d)[key]++;if(key==='planned')planned++;else if(key==='actual')actual++;else if(key==='arxSapac')arxSapac++;else sapacMace++;}
 let p=0,f=0,a=0,m=0;const curve=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,plannedTotal:p+=d.planned,actualTotal:f+=d.actual,arxSapacTotal:a+=d.arxSapac,sapacMaceTotal:m+=d.sapacMace}));
 return {total:rows.length,planned,actual,arxSapac,sapacMace,undated:rows.length-planned,curve,stages:counts(deliverableStage).sort((a,b)=>a.name.localeCompare(b.name)),disciplines:counts(r=>r.discipline||'Unclassified').sort((a,b)=>b.qty-a.qty),responsibility:counts(r=>r.scopeResponsibility||'ARX')};
}

// Smooth monotone segments through recorded totals; control points never overshoot.
export function cumulativePath(points,smooth=true){
 if(!points.length)return '';
 let path='M'+points[0].map(n=>n.toFixed(2)).join(' ');
 for(let i=1;i<points.length;i++){const [x0,y0]=points[i-1],[x1,y1]=points[i],dx=(x1-x0)/3;
  path+=smooth?' C'+(x0+dx).toFixed(2)+' '+y0.toFixed(2)+' '+(x1-dx).toFixed(2)+' '+y1.toFixed(2)+' '+x1.toFixed(2)+' '+y1.toFixed(2):' H'+x1.toFixed(2)+' V'+y1.toFixed(2);
 }
 return path;
}
