import schema from './company/hub/requirements-schema.json' with {type:'json'};
export {schema};
export const permitted=(user,row)=>!!user&&(user.owner||((user.assets.includes('*')||user.assets.includes(row.scopeId))&&(user.disciplines.includes('*')||user.disciplines.includes(row.discipline))));
export function validateRequirement(input,user,assets){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Check the requirement fields.');
 const data={};for(const f of schema.fields){const v=input[f.key]??'';if(typeof v!=='string'||v.length>f.max)throw Error(f.label+' is too long.');data[f.key]=v.trim();if(f.required&&!data[f.key])throw Error('Fill in '+f.label.toLowerCase()+'.');if(f.options&&data[f.key]&&!f.options.includes(data[f.key]))throw Error('Choose a valid '+f.label.toLowerCase()+'.');}
 if(data.scopeId!=='*'&&!assets.some(a=>a.id===data.scopeId))throw Error('Choose an in-scope asset.');
 if(!schema.disciplines.includes(data.discipline)||!permitted(user,data))throw Error('This asset and discipline are outside your editing scope.');
 if(data.reference){let u;try{u=new URL(data.reference);}catch{throw Error('Use a valid HTTPS reference link.');}if(u.protocol!=='https:'||u.username||u.password)throw Error('Use an HTTPS reference link without credentials.');}
 if(data.dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)||!Number.isFinite(Date.parse(data.dueDate))||new Date(data.dueDate).toISOString().slice(0,10)!==data.dueDate))throw Error('Choose a valid needed-by date.');
 data.status=input.status||'Draft';if(!schema.statuses.includes(data.status))throw Error('Choose a valid status.');return data;
}
export const missingHandover=data=>['parameter','dataType','format','criteria','provider','responsible','dueDate'].filter(k=>!data[k]);
export class RequirementsStore{
 constructor(storage){this.storage=storage;this.sql=storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)');this.sql.exec('CREATE TABLE IF NOT EXISTS requirement_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, requirement_id TEXT NOT NULL, body TEXT NOT NULL)');}
 get(id){const r=this.sql.exec('SELECT body FROM requirements WHERE id=?',id).toArray()[0];return r?JSON.parse(r.body):null;}
 list(user,assets){const allowed=new Set(assets.map(a=>a.id));return this.sql.exec('SELECT body FROM requirements ORDER BY rowid DESC').toArray().map(r=>JSON.parse(r.body)).filter(r=>(r.data.scopeId==='*'||allowed.has(r.data.scopeId))&&permitted(user,r.data));}
 events(id){return this.sql.exec('SELECT body FROM requirement_events WHERE requirement_id=? ORDER BY seq DESC LIMIT 150',id).toArray().map(r=>JSON.parse(r.body));}
 save(user,input,assets){
  if(!Number.isInteger(input?.revision)||input.revision<0)throw Error('Reload the register before saving.');
  const id=input.id||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid requirement.');
  const data=validateRequirement(input.data,user,assets);
  return this.storage.transactionSync(()=>{const old=this.get(id);if(input.id&&!old)throw Error('Requirement not found.');if(old&&(!permitted(user,old.data)||!assets.some(a=>a.id===old.data.scopeId)&&old.data.scopeId!=='*'))throw Error('This requirement is outside your scope.');if((old?.revision||0)!==input.revision)throw Error('Someone saved a newer version. Reload before saving.');
   if(!old&&this.sql.exec('SELECT COUNT(*) AS n FROM requirements').one().n>=10000)throw Error('Register capacity reached. Contact the owner.');
   const now=new Date().toISOString(),row={id,revision:input.revision+1,data,createdAt:old?.createdAt||now,createdBy:old?.createdBy||user.email,updatedAt:now,updatedBy:user.email};
   const changed=schema.fields.map(f=>f.key).concat('status').filter(k=>old?.data[k]!==data[k]);
   this.sql.exec('INSERT INTO requirements VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body',id,row.revision,JSON.stringify(row));
   this.sql.exec('INSERT INTO requirement_events(requirement_id,body) VALUES(?,?)',id,JSON.stringify({kind:old?'updated':'created',at:now,by:user.email,revision:row.revision,changed,before:old?.data||null,after:data}));return row;});
 }
 comment(user,id,text,assets){const row=this.get(id);if(!row||!permitted(user,row.data)||row.data.scopeId!=='*'&&!assets.some(a=>a.id===row.data.scopeId))throw Error('Requirement not found in your scope.');if(typeof text!=='string'||!text.trim()||text.length>3000)throw Error('Enter a comment up to 3,000 characters.');const event={kind:'comment',by:user.email,at:new Date().toISOString(),text:text.trim()};this.sql.exec('INSERT INTO requirement_events(requirement_id,body) VALUES(?,?)',id,JSON.stringify(event));return event;}
}
