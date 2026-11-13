const key='m1/reminders';
const defaults={revision:0,paused:true,sender:'',recipients:[],subject:'M1 — weekly Shared model update',message:'Please upload the latest native and NWC models to your assigned Shared folder, with matching filenames and descriptions. Update your tracker inputs after sharing.'};
const email=s=>typeof s==='string'&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export async function reminderSettings(env){return {...defaults,...await(await env.BUCKET.get(key))?.json(),schedule:'Wednesday · 2:00 PM · Asia/Dubai',connected:false};}
export function validateReminderSettings(input){
 if(!Number.isInteger(input?.revision)||typeof input.paused!=='boolean'||typeof input.sender!=='string'||(input.sender&&!email(input.sender)))throw Error('Check the sender address and reminder settings.');
 if(!Array.isArray(input.recipients)||input.recipients.length>100||input.recipients.some(r=>!email(r)))throw Error('Enter up to 100 valid recipient email addresses.');
 if(typeof input.subject!=='string'||!input.subject.trim()||input.subject.length>200||/[\r\n]/.test(input.subject)||typeof input.message!=='string'||!input.message.trim()||input.message.length>4000)throw Error('Check the reminder subject and message.');
 if(!input.paused)throw Error('Connect the approved sender before resuming reminders.');
 return {revision:input.revision,paused:input.paused,sender:input.sender.trim().toLowerCase(),recipients:[...new Set(input.recipients.map(s=>s.trim().toLowerCase()))],subject:input.subject.trim(),message:input.message.trim()};
}
export async function saveReminderSettings(env,input){const next=validateReminderSettings(input),old=await env.BUCKET.get(key),current=old?await old.json():defaults;if(next.revision!==current.revision)throw Error('The reminder settings changed. Reload before saving.');next.revision++;const saved=await env.BUCKET.put(key,JSON.stringify(next),{onlyIf:old?{etagMatches:old.etag}:new Headers({'If-None-Match':'*'})});if(!saved)throw Error('The reminder settings changed. Reload before saving.');return reminderSettings(env);}
