// Reporting uses recorded values only. Missing progress never becomes zero.
export function isoDay(value,date1904=false){
 if(value==null||value==='')return null;
 if(typeof value==='number'){if(!Number.isFinite(value)||value<1||value>100000)return null;return new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+Math.floor(value)*86400000).toISOString().slice(0,10);}
 const s=String(value).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s?s:null;
}
export function dubaiDay(now=Date.now()){return new Date(now+4*3600000).toISOString().slice(0,10);}
export function lookAheadEnd(start){return new Date(Date.parse(start+'T00:00:00Z')+13*86400000).toISOString().slice(0,10);}
const countBy=(rows,key)=>Object.entries(rows.reduce((a,r)=>{const k=key(r)||'Not reported';a[k]=(a[k]||0)+1;return a;},{})).map(([label,count])=>({label,count}));
const validPercent=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
export function engineeringSummary({tracker,midp,reviews,models}={},start=dubaiDay(),end=lookAheadEnd(start)){
 const rows=tracker?.rows||[],recorded=rows.filter(r=>!r.missingFromTracker),entries=midp?.entries||[];
 const visible=(pattern)=>tracker?.columns?.find(c=>!c.hidden&&pattern.test(c.label))?.key;
 const statusKey=visible(/^Status$/i),actualKey=visible(/^Actual Submission Date$/i),plannedKey=visible(/^Planned Submission Date/i),accKey=visible(/^ACC Status$/i);
 const tracked=recorded.map(r=>({...r,recordedStatus:r.fields?.[statusKey]||'Not reported',accStatus:r.fields?.[accKey]||'',planned:isoDay(r.fields?.[plannedKey],tracker.date1904),actual:isoDay(r.fields?.[actualKey],tracker.date1904)}));
 const progress=[...new Set(recorded.map(r=>r.discipline||'Unclassified'))].sort().map(label=>{const group=recorded.filter(r=>(r.discipline||'Unclassified')===label),logs=group.map(r=>r.log).filter(validPercent),lois=group.map(r=>r.loi).filter(validPercent);const avg=a=>a.length?Math.round(a.reduce((n,v)=>n+v,0)/a.length*10)/10:null;return {label,count:group.length,log:avg(logs),loi:avg(lois),logCount:logs.length,loiCount:lois.length};});
 const dated=entries.filter(r=>isoDay(r.plannedDate)),forecast=entries.filter(r=>isoDay(r.forecastDate));
 const planned=dated.filter(r=>r.plannedDate>=start&&r.plannedDate<=end),forecastWindow=forecast.filter(r=>r.forecastDate>=start&&r.forecastDate<=end);
 const batches=new Map();for(const r of dated){const key=JSON.stringify([r.plannedDate,r.scopeId,r.discipline]);if(!batches.has(key))batches.set(key,{date:r.plannedDate,asset:r.scopeId,name:r.scopeName,discipline:r.discipline,company:r.actualOriginator,models:0,drawings:0,other:0,total:0});const b=batches.get(key);b.total++;b[r.category==='Models'?'models':r.category==='Drawings'?'drawings':'other']++;}
 const reviewRows=(reviews?.reviews||[]).filter(r=>!/^void(?:ed)?$/i.test(r.status));
 return {start,end,loaded:{tracker:!!tracker,midp:!!midp,reviews:!!reviews},tracker:{source:tracker?.source,rows:rows.length,recorded:recorded.length,missing:rows.filter(r=>r.missingFromTracker).length,reportedLOG:recorded.filter(r=>validPercent(r.log)).length,progress,tracked,statuses:countBy(tracked,r=>r.recordedStatus),submitted:tracked.filter(r=>/^submitted$/i.test(r.recordedStatus)),pastPlanNoActual:tracked.filter(r=>r.planned&&r.planned<start&&!r.actual),actualCount:tracked.filter(r=>r.actual).length},midp:{source:midp?.source,total:entries.length,dated:dated.length,undated:entries.length-dated.length,forecast:forecast.length,planned,forecastWindow,batches:[...batches.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.asset.localeCompare(b.asset)),approvalFilled:entries.filter(r=>String(r.approvalStatus||'').trim()).length,affected:midp?.affectedDocuments||0,categories:countBy(entries,r=>r.category)},reviews:{source:reviews?.source,asOf:reviews?.reportAt,total:reviewRows.length,statuses:countBy(reviewRows,r=>r.status),disciplines:countBy(reviewRows,r=>r.discipline),open:reviewRows.filter(r=>/^open$/i.test(r.status)).length,closed:reviewRows.filter(r=>/^closed$/i.test(r.status)).length},models:{asOf:models?.scan?.checkedAt,groups:models?.scan?.files?.length??null,stale:models?.scan?.files?.filter(f=>f.updateState==='Over 7 working days').length??null}};
}
