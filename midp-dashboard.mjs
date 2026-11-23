import {MIDP_FILTER_KEYS,selectedValues,stageLabel,filterDeliverables,deliverableStage} from './delivery-core.mjs';
import {deliverySummary,cumulativePath} from './midp-summary.mjs';
const $=id=>document.getElementById(id);
let H,curveMode='smooth',summaryArgs;
const palette=['#178b82','#d89831','#647bc0','#aa6eb5','#528cac','#b76b59','#7c9561'];
const stageColour=code=>({'05':'#178b82','22':'#d89831','32':'#647bc0','42':'#aa6eb5','21':'#b76b59','31':'#528cac','41':'#7c9561'}[code]||'#8d939b');
export function readMidpSelection(key){return [...$('midp-'+key).selectedOptions].map(o=>o.value).filter(Boolean);}
export function setMidpSelection(key,value){const values=selectedValues(value),select=$('midp-'+key);for(const value of values)if(![...select.options].some(o=>o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=value;select.append(o);}for(const o of select.options)o.selected=values.includes(o.value);}
export function paintMidpFilter(key,values,current,label){
 const select=$('midp-'+key),chosen=selectedValues(current),all=[...new Set([...values,...chosen])];
 select.innerHTML=all.map(value=>'<option value="'+H.esc(value)+'"'+(chosen.includes(value)?' selected':'')+'>'+H.esc(label(value))+'</option>').join('');
 const details=$('midp-pick-'+key),query=details.querySelector('input[type="search"]'),q=query.value.toLowerCase(),focused=document.activeElement?.dataset.pickValue;
 details.querySelector('summary').textContent=chosen.length===0?'All':chosen.length===1?label(chosen[0]):chosen.length+' selected';
 details.classList.toggle('has-selection',!!chosen.length);
 details.querySelector('.midp-pick-options').innerHTML=all.map(value=>'<label'+(!label(value).toLowerCase().includes(q)?' hidden':'')+'><input type="checkbox" data-pick-value="'+H.esc(value)+'"'+(chosen.includes(value)?' checked':'')+(!values.includes(value)&&!chosen.includes(value)?' disabled':'')+'><span>'+H.esc(label(value))+(!values.includes(value)?' · no matches':'')+'</span></label>').join('')||'<p class="quiet">No matching choices</p>';
 if(focused&&details.open)[...details.querySelectorAll('[data-pick-value]')].find(e=>e.dataset.pickValue===focused)?.focus({preventScroll:true});
}
export function setupMidpDashboard(helpers){
 H=helpers;const register=$('midp-rows').closest('.register'),controls=document.createElement('section');controls.className='panel midp-controls';controls.setAttribute('aria-label','MIDP filters');
 for(const f of [...register.querySelectorAll(':scope > .filters')])controls.append(f);
 $('midp-kpis').before(controls);
 for(const key of MIDP_FILTER_KEYS){const select=$('midp-'+key),old=select.parentElement,title=old.firstChild.textContent.trim(),wrap=document.createElement('div');wrap.className='midp-filter-field';wrap.innerHTML='<span>'+H.esc(title)+'</span>';old.replaceWith(wrap);select.multiple=true;select.hidden=true;wrap.append(select);const details=document.createElement('details');details.id='midp-pick-'+key;details.className='midp-pick';details.innerHTML='<summary aria-label="'+H.esc(title)+'">All</summary><div class="midp-pick-menu"><input type="search" placeholder="Find an option…" aria-label="Search '+H.esc(title)+'"><button type="button" class="midp-pick-clear">Clear selection</button><div class="midp-pick-options"></div></div>';wrap.append(details);
  details.addEventListener('change',e=>{if(!e.target.matches('[data-pick-value]'))return;const chosen=readMidpSelection(key),value=e.target.dataset.pickValue;H.setFilter(key,e.target.checked?[...new Set([...chosen,value])]:chosen.filter(v=>v!==value));});
  details.querySelector('.midp-pick-clear').onclick=()=>H.setFilter(key,[]);
  details.querySelector('input[type="search"]').oninput=e=>{for(const row of details.querySelectorAll('.midp-pick-options label'))row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase());};
  details.addEventListener('toggle',()=>{if(details.open)for(const other of document.querySelectorAll('.midp-pick[open]'))if(other!==details)other.open=false;});
 }
 compactMidpFilters(controls);
 document.addEventListener('pointerdown',e=>{for(const d of document.querySelectorAll('.midp-pick[open]'))if(!d.contains(e.target))d.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const d of document.querySelectorAll('.midp-pick[open]')){d.open=false;d.querySelector('summary').focus();}});
 const summary=document.createElement('section');summary.id='midp-summary';summary.className='midp-summary';register.before(summary);
 summary.addEventListener('click',e=>{const mode=e.target.closest('[data-curve-mode]');if(mode){curveMode=mode.dataset.curveMode;renderMidpSummary(...summaryArgs);return;}const b=e.target.closest('[data-summary-key]');if(!b)return;const key=b.dataset.summaryKey,value=b.dataset.summaryValue,chosen=readMidpSelection(key);H.setFilter(key,value===''?[]:chosen.includes(value)?chosen.filter(v=>v!==value):[...chosen,value]);});
}
function curveMarkup(s){
 const {esc}=H;
 if(!s.curve.length)return '<div class="empty"><strong>No scheduled dates in this selection</strong><p>Fill Planned or actual Issue Dates in the TIDPs to build the curve.</p></div>';
 const w=1100,h=280,l=58,r=28,t=25,b=40,dates=s.curve.map(d=>Date.parse(d.date)),pad=Math.max(86400000,(Math.max(...dates)-Math.min(...dates))*.05),min=Math.floor((Math.min(...dates)-pad)/86400000)*86400000,max=Math.ceil((Math.max(...dates)+pad)/86400000)*86400000,maxQ=Math.max(s.planned,s.actual,1),x=n=>l+(n-min)/(max-min)*(w-l-r),y=n=>h-b-n/maxQ*(h-t-b);
 const points=[{date:new Date(min).toISOString().slice(0,10),plannedTotal:0,actualTotal:0},...s.curve,{...s.curve.at(-1),date:new Date(max).toISOString().slice(0,10)}];
 const path=key=>cumulativePath(points.map(d=>[x(Date.parse(d.date)),y(d[key])]),curveMode==='smooth');
 const ticks=[0,...[1,2,3,4].map(i=>Math.ceil(maxQ*i/4))].filter((v,i,a)=>a.indexOf(v)===i);
 const grid=ticks.map(n=>'<line x1="'+l+'" x2="'+(w-r)+'" y1="'+y(n)+'" y2="'+y(n)+'" stroke="#e7e9ec"/><text x="'+(l-12)+'" y="'+(y(n)+4)+'" text-anchor="end">'+n.toLocaleString('en-GB')+'</text>').join('');
 const labels=Array.from({length:5},(_,i)=>{const n=min+(max-min)*i/4;return '<text x="'+x(n)+'" y="'+(h-16)+'" text-anchor="'+(i===0?'start':i===4?'end':'middle')+'">'+new Date(n).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:'UTC'})+'</text>';}).join('');
 const lines=[['plannedTotal',s.planned,'#168b83','Planned'],['actualTotal',s.actual,'#cb872b','Actual issued']].filter(([,n])=>n).map(([key,,colour,title])=>'<path d="'+path(key)+'" fill="none" stroke="'+colour+'" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+s.curve.map(d=>'<circle tabindex="0" cx="'+x(Date.parse(d.date))+'" cy="'+y(d[key])+'" r="4" fill="'+colour+'" class="midp-curve-point" aria-label="'+esc(title+' · '+d.date+' · '+d[key]+' deliverables')+'"><title>'+esc(title+' · '+d.date+' · '+d[key]+' deliverables')+'</title></circle>').join('')).join('');
 return '<svg class="midp-curve" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Cumulative planned and actual issued quantities of deliverables"><text x="'+l+'" y="13">Deliverables · QTY</text>'+grid+labels+lines+'</svg>';
}
function compactMidpFilters(controls){
 const old=[...controls.querySelectorAll(':scope > .filters')],primary=document.createElement('div');primary.className='midp-primary-filters';
 primary.append($('midp-search').closest('label'));
 for(const key of ['stage','discipline','asset'])primary.append($('midp-'+key).closest('.midp-filter-field'));
 const more=document.createElement('button');more.id='midp-more-filters';more.type='button';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','midp-extra-filters');more.textContent='More filters';primary.append(more);
 const footer=document.createElement('div');footer.className='midp-filter-footer';footer.append($('midp-start').closest('label'),$('midp-end').closest('label'));
 const actions=document.createElement('div');actions.className='midp-filter-actions';actions.append($('midp-clear'),$('midp-export'));footer.append(actions);
 const extra=document.createElement('div');extra.id='midp-extra-filters';extra.className='midp-extra-filters';extra.hidden=true;
 for(const key of MIDP_FILTER_KEYS.filter(k=>!['stage','discipline','asset'].includes(k)))extra.append($('midp-'+key).closest('.midp-filter-field'));
 const chips=document.createElement('div');chips.id='midp-active-filters';chips.className='midp-active-filters';chips.hidden=true;
 controls.append(primary,footer,extra,chips);for(const el of old)el.remove();
 more.onclick=()=>{extra.hidden=!extra.hidden;more.setAttribute('aria-expanded',String(!extra.hidden));};
 chips.onclick=e=>{const b=e.target.closest('[data-clear-midp]');if(b)H.setFilter(b.dataset.clearMidp,[]);};
}
function updateCompactFilters(filters){
 const extraKeys=MIDP_FILTER_KEYS.filter(k=>!['stage','discipline','asset'].includes(k)),n=extraKeys.filter(k=>selectedValues(filters[k]).length).length;
 $('midp-more-filters').textContent='More filters'+(n?' · '+n+' active':'');
 const active=MIDP_FILTER_KEYS.filter(k=>selectedValues(filters[k]).length),chips=$('midp-active-filters');chips.hidden=!active.length;
 chips.innerHTML=active.map(key=>{const values=selectedValues(filters[key]),label=$('midp-'+key).closest('.midp-filter-field').querySelector(':scope > span').textContent;return '<button type="button" data-clear-midp="'+key+'" aria-label="Clear '+H.esc(label)+' filter">'+H.esc(label)+': '+H.esc(values.length===1?values[0]:values.length+' selected')+' <span aria-hidden="true">×</span></button>';}).join('');
}
export function renderMidpSummary(all,filters,rows){
 if(!H)return;summaryArgs=[all,filters,rows];updateCompactFilters(filters);const {esc}=H,s=deliverySummary(rows),chip=(key,value,label,qty)=>'<button type="button" data-summary-key="'+key+'" data-summary-value="'+esc(value)+'" aria-pressed="'+selectedValues(filters[key]).includes(value)+'"><span>'+(key==='stage'?'<i class="midp-stage-swatch" style="background:'+stageColour(value)+'"></i>':'')+esc(label)+'</span><strong>'+qty.toLocaleString('en-GB')+'</strong></button>';
 const context=key=>filterDeliverables(all,{...filters,[key]:[]});
 const responsibility=deliverySummary(context('responsibility')),stages=deliverySummary(context('stage')),disciplines=deliverySummary(context('discipline'));
 let offset=0;const segments=s.stages.map((d,i)=>{const start=offset;offset+=d.qty/Math.max(s.total,1)*100;return stageColour(d.name)+' '+start+'% '+offset+'%';});
 const stageLegend=stages.stages.map((d,i)=>chip('stage',d.name,stageLabel(d.name),d.qty)).join('');
 const maxDisc=Math.max(1,...disciplines.disciplines.map(d=>d.qty));
 $('midp-summary').innerHTML='<article class="panel midp-curve-panel"><div class="panel-title"><div><p class="eyebrow">DELIVERY OUTLOOK · QUANTITIES</p><h2>Delivery S-curve</h2></div><div class="midp-curve-tools"><div class="midp-curve-toggle" aria-label="Curve display"><button data-curve-mode="smooth" aria-pressed="'+(curveMode==='smooth')+'">Smooth</button><button data-curve-mode="steps" aria-pressed="'+(curveMode==='steps')+'">Exact steps</button></div><button id="midp-summary-export">Export summary ↓</button></div></div><div class="midp-scope-buttons" role="group" aria-label="Scope responsibility"><button data-summary-key="responsibility" data-summary-value="" aria-pressed="'+!selectedValues(filters.responsibility).length+'"><span>All scope</span><strong>'+responsibility.total.toLocaleString('en-GB')+'</strong></button>'+['ARX','ATM'].map(v=>chip('responsibility',v,v,responsibility.responsibility.find(d=>d.name===v)?.qty||0)).join('')+'</div><div class="midp-curve-stats"><span><i style="background:#168b83"></i>Planned <b>'+s.planned.toLocaleString('en-GB')+'</b></span><span><i style="background:#cb872b"></i>Actual issued <b>'+s.actual.toLocaleString('en-GB')+'</b></span><span>No planned date <b>'+s.undated.toLocaleString('en-GB')+'</b></span><span>Selected deliverables <b>'+s.total.toLocaleString('en-GB')+'</b></span></div>'+curveMarkup(s)+'<p class="midp-curve-caption quiet">'+(curveMode==='smooth'?'Smoothed between recorded dates · dots show exact totals.':'Exact cumulative totals at each recorded date.')+(!s.actual?' No actual issue dates recorded for this selection.':'')+'</p><details class="midp-curve-table"><summary>Dates &amp; calculation basis</summary><p class="quiet">Actual = latest Issue Date across MIDP data exchanges, through today. Each deliverable counts once. Planned-date range filters apply to both series. ARX includes all scoped assets except original ATM scope. Undated entries remain in totals, outside the curve.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Planned on date</th><th>Planned cumulative</th><th>Actual issued on date</th><th>Actual cumulative</th></tr></thead><tbody>'+s.curve.map(d=>'<tr><td>'+d.date+'</td><td>'+d.planned+'</td><td>'+d.plannedTotal+'</td><td>'+d.actual+'</td><td>'+d.actualTotal+'</td></tr>').join('')+'</tbody></table></div></details></article><div class="midp-summary-breakdown"><article class="panel"><div class="panel-title"><div><p class="eyebrow">DESIGN STAGE</p><h2>Deliverables by stage</h2></div></div><div class="midp-stage-layout"><div class="receipt-ring" style="background:conic-gradient('+ (segments.join(',')||'#e9ebed 0% 100%') +')"><div><strong>'+s.total.toLocaleString('en-GB')+'</strong><small>deliverables</small></div></div><div class="midp-stage-buttons">'+stageLegend+'</div></div><p class="quiet">Select stages to combine them. Quantities on buttons respect all other filters.</p></article><article class="panel"><div class="panel-title"><div><p class="eyebrow">ENGINEERING DISCIPLINES</p><h2>Deliverables by discipline</h2></div></div><div class="midp-discipline-bars">'+disciplines.disciplines.map((d,i)=>'<button data-summary-key="discipline" data-summary-value="'+esc(d.name)+'" aria-pressed="'+selectedValues(filters.discipline).includes(d.name)+'"><span>'+esc(d.name)+'</span><i><b style="width:'+d.qty/maxDisc*100+'%;background:'+palette[i%palette.length]+'"></b></i><strong>'+d.qty.toLocaleString('en-GB')+'</strong></button>').join('')+'</div></article></div>';
 $('midp-summary-export').onclick=()=>H.csv('M1-MIDP-delivery-summary.csv',[['Measure','Date / group','Quantity','Cumulative quantity'],['Selected deliverables','',s.total,''],['Without planned date','',s.undated,''],...s.responsibility.map(d=>['Scope',d.name,d.qty,'']),...s.stages.map(d=>['Design stage',stageLabel(d.name),d.qty,'']),...s.disciplines.map(d=>['Discipline',d.name,d.qty,'']),...s.curve.flatMap(d=>[['Planned',d.date,d.planned,d.plannedTotal],['Actual issued',d.date,d.actual,d.actualTotal]])]);
}
