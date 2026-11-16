(function(root){
'use strict';
const DAY=86400000,OFFSET=3*3600000;
function instant(value){if(value===null||value===undefined||value==='')return null;const t=typeof value==='number'?value:Date.parse(value);return Number.isFinite(t)?t:null;}
function dateKey(value){if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return validDay(value)?value:'';const t=instant(value);return t===null?'':new Date(t+OFFSET).toISOString().slice(0,10);}
function validDay(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function workingDays(start,end){const a=instant(start),b=instant(end);if(a===null||b===null||b<a)return null;let cursor=a+OFFSET,stop=b+OFFSET,total=0;while(cursor<stop){const day=Math.floor(cursor/DAY)*DAY,next=Math.min(day+DAY,stop),weekday=new Date(day).getUTCDay();if(weekday!==5)total+=next-cursor;cursor=next;}return total/DAY;}
function rangeValid(from,to){return (!from||validDay(from))&&(!to||validDay(to))&&(!from||!to||from<=to);}
function inRange(value,from='',to=''){if(!rangeValid(from,to))return false;if(!from&&!to)return true;const key=dateKey(value);return !!key&&(!from||key>=from)&&(!to||key<=to);}
function latest(values){const dates=values.map(instant).filter(v=>v!==null);return dates.length?Math.max(...dates):null;}
const api={DAY,dateKey,instant,workingDays,rangeValid,inRange,latest,calendar:'Saturday–Thursday · Friday excluded · Saudi time (UTC+03)'};
root.DateRules=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
