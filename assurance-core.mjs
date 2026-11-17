// Shared, dependency-free import contract. No provider writes or model edits.
export const KINDS=['rfi','clashes','qaqc'];
export const FIELDS={id:'Reference / stable ID',title:'Title / check name',status:'Status / result',asset:'Asset code / scope ID',discipline:'Discipline',owner:'Responsible party',created:'Created / submitted date',due:'Due date',closed:'Closed / answered date',updated:'Updated date',test:'Clash test',group:'Clash group',model:'Model filename',version:'ACC model version',element:'Element IDs',description:'Description / finding',url:'ACC link'};
const text=v=>String(v??'').trim();
export function safeLink(v){try{const u=new URL(v);return u.protocol==='https:'&&['acc.autodesk.com','acc.autodesk.eu','docs.b360.autodesk.com','docs.b360.eu.autodesk.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function parseDate(v,order='DMY'){
 if(v===null||v===undefined||v==='')return null;
 if(typeof v==='number'){if(!Number.isFinite(v)||v<20000||v>100000)throw Error('Invalid Excel date.');return new Date(Math.round((v-25569)*86400000)).toISOString().slice(0,10);}
 const s=text(v);let m=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s);
 if(!m){const a=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s.*)?$/.exec(s);if(!a||order==='ISO')throw Error('Use ISO dates or select the day/month order: '+s);m=['',a[3],order==='MDY'?a[1]:a[2],order==='MDY'?a[2]:a[1]];}
 const day=[m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-');if(!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw Error('Invalid date: '+s);return day;
}
export function parseCSV(source){
 source=source.replace(/^\uFEFF/,'');const delim=(source.split(/\r?\n/)[0].match(/;/g)||[]).length>(source.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',';
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delim&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('Unclosed CSV quotation.');row.push(cell);if(row.some(v=>v!==''))rows.push(row);return rows;
}
export function suggestMapping(headers){const aliases={id:['id','rfi id','rfi number','rfi #','number','reference','clash id','guid','check id'],title:['title','subject','name','check name','clash name'],status:['status','result','check result'],asset:['asset','asset code','scope id'],discipline:['discipline'],owner:['assigned to','assignee','ball in court','responsible party','owner'],created:['created at','created on','created date','date created','submitted date'],due:['due date','due'],closed:['closed at','closed date','answered date'],updated:['updated at','updated date'],test:['test','clash test','test name'],group:['group','clash group'],model:['model','model filename','file name','filename'],version:['version','acc model version'],element:['element ids','element id'],description:['description','finding'],url:['url','acc link','link']};const clean=s=>text(s).toLowerCase().replace(/[_\s]+/g,' ');return Object.fromEntries(Object.entries(aliases).map(([k,a])=>[k,headers.findIndex(h=>a.includes(clean(h))||clean(h)===clean(FIELDS[k])||clean(h)===k)]));}
export function mappedRows(matrix,headerIndex,map,dateOrder){return matrix.slice(headerIndex+1).filter(r=>r.some(v=>text(v))).map((r,i)=>{const out={};for(const [k,n] of Object.entries(map)){if(n<0)continue;try{out[k]=['created','due','closed','updated'].includes(k)?parseDate(r[n],dateOrder):text(r[n]);}catch(e){throw Error('Row '+(headerIndex+i+2)+': '+e.message);}}return out;});}
export function assetFor(value,assets){const v=text(value).toUpperCase();if(!v)return null;const exact=assets.find(a=>a.id.toUpperCase()===v);if(exact)return exact;const found=assets.filter(a=>[a.code,a.proposed,...(a.aliases||[])].some(c=>c&&String(c).toUpperCase()===v));return found.length===1?found[0]:null;}
export function validateImport(input,assets){
 if(!input||!KINDS.includes(input.kind)||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>10000)throw Error('Select a non-empty report with up to 10,000 records.');
 const batch=text(input.batch),source=text(input.source),asOf=parseDate(input.asOf);if(!batch||batch.length>120||!source||source.length>250||!asOf)throw Error('Supply a register name, source filename and report date.');
 if(asOf>new Date().toISOString().slice(0,10))throw Error('The report date cannot be in the future.');
 const rows=[],unmapped=[],seen=new Set();for(let i=0;i<input.rows.length;i++){
  const raw=input.rows[i];if(!raw||typeof raw!=='object')throw Error('Invalid row.');const r={};for(const k of Object.keys(FIELDS)){r[k]=['created','due','closed','updated'].includes(k)?parseDate(raw[k]):text(raw[k]);if(typeof r[k]==='string'&&r[k].length>(k==='description'?3000:500))throw Error('Row '+(i+1)+': '+k+' is too long.');}
  r.recordType=raw.recordType==='group'?'group':'clash';r.parentId=text(raw.parentId);r.sourceRow=i+1;
  if(!r.id||!r.title||!r.status)throw Error('Row '+(i+1)+': reference, title and status are required.');
  if(input.kind==='qaqc'&&(!r.model||!r.version))throw Error('QA/QC records require model filename and the checked ACC version.');
  r.key=JSON.stringify(input.kind==='clashes'?[r.test,r.recordType,r.id]:input.kind==='qaqc'?[r.model,r.version,r.id]:[r.id]);
  if(seen.has(r.key))throw Error('Duplicate reference in this report: '+r.id+'. Use stable unique IDs.');seen.add(r.key);
  if(r.url&&!safeLink(r.url))throw Error('Only Autodesk ACC links can be saved.');
  const a=assetFor(r.asset||input.scopeId,assets);if(!a){unmapped.push({row:i+1,id:r.id,asset:r.asset});continue;}
  r.scopeId=a.id;r.asset=a.proposed||a.code;r.assetName=a.name;rows.push(r);
 }
 if(!rows.length)throw Error('No scoped records found. Select an asset or map the Asset column to a confirmed scope code.');
 return {kind:input.kind,batch,source,asOf,rows,unmapped,total:input.rows.length};
}
export function importDiff(previous,prepared){const old=new Map((previous?.rows||[]).map(r=>[r.key,r]));let added=0,changed=0;for(const r of prepared.rows){const p=old.get(r.key);if(!p)added++;else if(JSON.stringify({...p,sourceRow:0})!==JSON.stringify({...r,sourceRow:0}))changed++;old.delete(r.key);}return {added,changed,notInLatest:old.size};}
export const isFinished=r=>/^(closed|answered|resolved|approved|passed|pass|not applicable|n\/a)$/i.test(r.status);
export function assessmentState(row,scan){
 if(!scan?.checkedAt)return 'Current model version not checked';
 const found=(scan.files||[]).filter(f=>f.scopeId===row.scopeId&&String(f.name).toLowerCase()===row.model.toLowerCase());
 if(!found.length)return 'Model not found in latest folder scan';
 const ids=new Set(found.map(f=>f.id)),versions=new Set(found.map(f=>String(f.version)));
 if(ids.size>1||versions.size!==1)return 'Model/version match needs review';
 return versions.has(String(row.version))?'Matches scanned ACC version':'Awaiting model check — ACC version changed';
}
