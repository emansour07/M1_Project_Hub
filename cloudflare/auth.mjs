const encoder=new TextEncoder(),COOKIE='__Host-m1-owner';
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const bytes=str=>Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function validAdminKey(candidate,secret){
  if(!secret||secret.length<40||typeof candidate!=='string'||candidate.length>200)return false;
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(candidate)));
  const b=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(secret)));
  let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];return different===0;
}
export async function sessionCookie(secret,origin){
  const payload=b64url(encoder.encode(JSON.stringify({role:'owner',aud:origin,exp:Date.now()+12*3600000,nonce:crypto.randomUUID()})));
  const signature=b64url(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload)));
  return `${COOKIE}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`;
}
export async function isOwner(request,secret){
  if(!secret||secret.length<40)return false;
  const cookie=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
  if(!cookie||cookie.length>1500)return false;
  try{
    const [payload,signature,extra]=cookie.slice(COOKIE.length+1).split('.');if(extra)return false;
    if(!await crypto.subtle.verify('HMAC',await key(secret),bytes(signature),encoder.encode(payload)))return false;
    const claims=JSON.parse(new TextDecoder().decode(bytes(payload)));
    return claims.role==='owner'&&claims.aud===new URL(request.url).origin&&Number.isFinite(claims.exp)&&claims.exp>Date.now()&&claims.exp<=Date.now()+12*3600000;
  }catch{return false;}
}
export async function readLoginForm(request){
  if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return '';
  if(Number(request.headers.get('Content-Length'))>2048)return '';
  const reader=request.body?.getReader();if(!reader)return '';
  let body='',size=0;const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return '';}body+=decoder.decode(value,{stream:true});}
  body+=decoder.decode();return new URLSearchParams(body);
}
export async function readLoginKey(request){const form=await readLoginForm(request);return form instanceof URLSearchParams?form.get('key')||'':'';}
export function loginPage(failed=false){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M1 · Owner access</title><style>body{margin:0;background:#f3f3f3;color:#323232;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{background:white;padding:36px;border-radius:18px;max-width:400px;box-shadow:0 20px 60px #32323218}label{display:block;margin:24px 0 8px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #c4c4c4;border-radius:8px}button{margin-top:20px;background:#323232;color:white;border:0;padding:12px 24px;border-radius:8px;cursor:pointer}p{line-height:1.6;color:#727272}.error{color:#4b4b4b}</style></head><body><main><h1>M1 owner access</h1><p>Sign in to manage the Autodesk connection and upload reports.</p>${failed?'<p class="error">'+(typeof failed==='string'?failed:'The owner code was not accepted.')+'</p>':''}<form method="post" action="/admin/login"><label for="key">Owner code</label><input id="key" name="key" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></main></body></html>`;}
