// Autodesk Secure Service Account; read-only user-context token restricted by ACC membership.
const API='https://developer.api.autodesk.com/authentication/v2/token',enc=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const serviceConfigured=env=>['APS_CLIENT_ID','APS_CLIENT_SECRET','APS_SSA_ID','APS_SSA_KID','APS_SSA_PRIVATE_KEY'].every(k=>!!env[k]);
function der(tag,body){const n=body.length,length=n<128?[n]:n<256?[129,n]:n<65536?[130,n>>8,n&255]:[131,n>>16,(n>>8)&255,n&255];return new Uint8Array([tag,...length,...body]);}
export function privateKeyBytes(pem){const bytes=Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));return pem.includes('BEGIN RSA PRIVATE KEY')?der(48,new Uint8Array([2,1,0,48,13,6,9,42,134,72,134,247,13,1,1,1,5,0,...der(4,bytes)])):bytes;}
export async function serviceAssertion(env,now=Date.now(),scopes=['data:read']){
 if(!serviceConfigured(env))throw Error('M1 service account setup is incomplete.');
 const header=b64url(enc.encode(JSON.stringify({alg:'RS256',kid:env.APS_SSA_KID}))),claims=b64url(enc.encode(JSON.stringify({iss:env.APS_CLIENT_ID,sub:env.APS_SSA_ID,aud:API,exp:Math.floor(now/1000)+300,scope:scopes})));
 const body=header+'.'+claims,key=await crypto.subtle.importKey('pkcs8',privateKeyBytes(env.APS_SSA_PRIVATE_KEY),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 return body+'.'+b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(body)));
}
export async function serviceAccessToken(env,seal,unseal){
 const storeKey='m1/ssa/token',saved=await env.BUCKET.get(storeKey);if(saved){const value=await unseal(env,await saved.json());if(value.issuedAt>Date.now()-900000&&value.clientId===env.APS_CLIENT_ID&&value.permissionVersion===(env.APS_PERMISSION_VERSION||'')&&value.expiresAt>Date.now()+120000)return value.access_token;}
 const assertion=await serviceAssertion(env),r=await fetch(API,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Basic '+btoa(env.APS_CLIENT_ID+':'+env.APS_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion,scope:'data:read'})});
 if(!r.ok)throw Error('M1 service account authentication failed ('+r.status+').');const token=await r.json();if(!token.access_token||!Number.isFinite(token.expires_in))throw Error('Invalid service account token response.');
 await env.BUCKET.put(storeKey,JSON.stringify(await seal(env,{issuedAt:Date.now(),permissionVersion:env.APS_PERMISSION_VERSION||'',clientId:env.APS_CLIENT_ID,access_token:token.access_token,expiresAt:Date.now()+token.expires_in*1000})));return token.access_token;
}

// Requested only inside an owner-approved publication to the fixed M1 tracker.
export async function trackerWriteToken(env){const assertion=await serviceAssertion(env,Date.now(),['data:read','data:write','data:create']);const r=await fetch(API,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Basic '+btoa(env.APS_CLIENT_ID+':'+env.APS_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion,scope:'data:read data:write data:create'})});if(!r.ok)throw Error('Autodesk has not enabled tracker publishing for this integration.');const t=await r.json();if(!t.access_token)throw Error('Tracker publishing is unavailable.');return t.access_token;}
