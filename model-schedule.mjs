// Each wake processes one bounded batch; neither folder scan can starve the other.
export function scanDueAt(kind,s,now=Date.now(),manual=false){
 let due=s.active?0:(s.nextAt||0);
 if(kind==='progress'&&manual&&s.lastAttempt+60000<=now&&s.lastFailure?.status!==429)due=0;
 if(kind==='progress'){
  if(s.active)due=Math.max(due,s.batchNotBefore||0);
  if(s.lastFailure?.status===429)due=Math.max(due,s.nextAt||0);
 }else due=Math.max(due,s.nextBatch||0);
 return Math.max(due,s.leaseUntil||0);
}
export function selectScan(states,last,now=Date.now(),manual=false){
 const order=last==='progress'?['formats','progress']:['progress','formats'];
 return order.find(kind=>scanDueAt(kind,states[kind],now,manual)<=now)||null;
}

export async function ensureModelAlarm(storage,enabled,now=Date.now()){
 if(enabled&&await storage.getAlarm()===null)await storage.setAlarm(now+1000);
}

export async function runModelAlarm(storage,enabled,run,next){
 if(!enabled)return;
 // A fallback wake also survives a worker termination while a provider call is pending.
 await storage.setAlarm(Date.now()+120000);
 try{await run();}catch{/* The scanner retains the last complete snapshot and its retry time. */}
 finally{await storage.setAlarm(Math.max(Date.now()+15000,await next()));}
}
