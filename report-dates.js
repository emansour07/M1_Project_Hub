(function(root){
'use strict';
function create({id,container,fields,onChange}){
 const host=document.createElement('div');host.className='filters report-dates';
 const label=(text,input)=>{const l=document.createElement('label');l.textContent=text;l.append(input);host.append(l);return input;};
 const select=document.createElement('select');select.id=id+'-field';label('Date to filter',select);
 for(const [value,text] of fields){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}
 const from=label('From',Object.assign(document.createElement('input'),{type:'date',id:id+'-from'}));
 const to=label('To',Object.assign(document.createElement('input'),{type:'date',id:id+'-to'}));
 const clear=Object.assign(document.createElement('button'),{type:'button',textContent:'Clear dates'});host.append(clear);
 const note=document.createElement('span');note.className='quiet report-date-note';note.setAttribute('aria-live','polite');host.append(note);container.append(host);
 const paint=()=>{note.textContent=!root.DateRules.rangeValid(from.value,to.value)?'End date must be on or after start date.':from.value||to.value?'Inclusive dates. Records without the selected date are excluded.':'All dates';};
 const change=()=>{paint();onChange();};for(const el of [select,from,to])el.addEventListener('change',change);
 clear.onclick=()=>{from.value='';to.value='';change();};paint();
 return {matches:get=>root.DateRules.inRange(typeof get==='function'?get(select.value):get,from.value,to.value),active:()=>!!(from.value||to.value),valid:()=>root.DateRules.rangeValid(from.value,to.value),clear:()=>{from.value='';to.value='';paint();},setFields:fields=>{const old=select.value;select.replaceChildren();for(const [value,text]of fields){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}if(fields.some(([v])=>v===old))select.value=old;},field:()=>select.value};
}
root.ReportDates={create};
})(globalThis);
