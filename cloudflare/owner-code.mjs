import {validAdminKey} from './auth.mjs';
const encoder=new TextEncoder(),WINDOW=15*60*1000;
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(value.match(/../g),part=>parseInt(part,16));
async function verifier(code,salt,pepper){
 const key=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const prehash=await crypto.subtle.sign('HMAC',key,encoder.encode(code));
 const material=await crypto.subtle.importKey('raw',prehash,'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},material,256));
}
export class OwnerCodeAuth {
 constructor(sql,secret){this.sql=sql;this.secret=secret;
  sql.exec('CREATE TABLE IF NOT EXISTS owner_code (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, verifier TEXT NOT NULL, version TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS owner_login_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
 }
 record(){return this.sql.exec('SELECT salt, verifier, version FROM owner_code WHERE id=1').toArray()[0]||null;}
 sessionSecret(record){if(!this.secret||this.secret.length<40)return '';return record?this.secret+':owner-code:'+record.version:this.secret;}
 attempt(request){
  const now=Date.now(),expires=now+WINDOW;
  this.sql.exec('DELETE FROM owner_login_limits WHERE expires <= ?',now);
  for(const [key,limit] of [['global',200],['ip:'+(request.headers.get('CF-Connecting-IP')||'unknown').slice(0,100),10]]){
   const result=this.sql.exec('INSERT INTO owner_login_limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count',key,expires,limit).toArray()[0];
   if(!result){const row=this.sql.exec('SELECT expires FROM owner_login_limits WHERE key=?',key).toArray()[0];return Math.max(1,Math.ceil((row.expires-now)/1000));}
  }return 0;
 }
 async verify(candidate,record){
  if(!this.sessionSecret(record))return false;
  if(!record)return validAdminKey(candidate,this.secret);
  if(typeof candidate!=='string'||candidate.length<8||candidate.length>128)return false;
  const actual=await verifier(candidate,record.salt,this.secret);let diff=0;
  for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^record.verifier.charCodeAt(i);
  return diff===0;
 }
 async change(candidate,record){
  if(typeof candidate!=='string'||candidate.length<8||candidate.length>128||!candidate.trim())throw Error('Use a code with 8 to 128 characters.');
  if(!this.sessionSecret(record))throw Error('Owner access is not configured');
  const next={salt:hex(crypto.getRandomValues(new Uint8Array(16))),version:crypto.randomUUID()};
  next.verifier=await verifier(candidate,next.salt,this.secret);
  const rows=record?this.sql.exec('UPDATE owner_code SET salt=?,verifier=?,version=? WHERE id=1 AND version=? RETURNING version',next.salt,next.verifier,next.version,record.version):this.sql.exec('INSERT INTO owner_code (id,salt,verifier,version) VALUES (1,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING version',next.salt,next.verifier,next.version);
  return rows.toArray().length?next:null;
 }
}
const styles='body{margin:0;background:#f3f3f3;color:#323232;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{box-sizing:border-box;background:white;padding:36px;border-radius:18px;width:min(460px,calc(100% - 32px));box-shadow:0 20px 60px #32323218}label{display:block;margin:24px 0 8px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #c4c4c4;border-radius:8px;font:inherit}button{margin-top:24px;background:#323232;color:white;border:0;padding:12px 24px;border-radius:8px;cursor:pointer;font:inherit}p{line-height:1.6;color:#727272}.error{color:#4b4b4b}a{color:#323232}small{display:block;margin-top:8px;color:#727272}';
export function codePage(message=''){
 const safe=message.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M1 · Choose owner code</title><style>'+styles+'</style></head><body><main><h1>Choose your owner code</h1><p>Use this code whenever you sign in to manage M1. The team dashboard stays open without signing in.</p>'+(safe?'<p class="error" role="alert">'+safe+'</p>':'')+'<form method="post" action="/admin/code"><label for="code">New owner code</label><input type="password" id="code" name="code" autocomplete="new-password" minlength="8" maxlength="128" required><small>At least 8 characters. A longer phrase is easier to remember.</small><label for="confirm">Confirm owner code</label><input type="password" id="confirm" name="confirm" autocomplete="new-password" minlength="8" maxlength="128" required><button type="submit">Save owner code</button></form><p>Your previous code and other signed-in sessions will stop working.</p><a href="/admin">Back to dashboard</a></main></body></html>';
}
export function codeSavedPage(){return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M1 · Owner code updated</title><style>'+styles+'</style></head><body><main><h1>Owner code updated</h1><p>Your new code is ready to use. You are signed in, and the team dashboard remains open.</p><p><a href="/admin">Open owner dashboard</a></p></main></body></html>';}
