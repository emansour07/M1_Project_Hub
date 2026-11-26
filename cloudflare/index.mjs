import submissionsHtml from './submissions.html';
import progressFormHtml from '../company/hub/templates/hub/progress_form.html';
import progressRequestsHtml from '../company/hub/templates/hub/progress_requests.html';
import {progressMailTick} from '../progress-requests.mjs';
import {syncIssues} from '../assurance.mjs';
import assuranceImportHtml from './assurance-import.html';
import {syncTidpBatch} from '../tidp-sync.mjs';
import receivedImportHtml from '../company/hub/templates/hub/received_import.html';
import {DurableObject} from 'cloudflare:workers';
import {M1Application} from '../application.mjs';
import {syncModelSources,nextModelSyncAt} from '../progress.mjs';
import {ensureModelAlarm,runModelAlarm} from '../model-schedule.mjs';
import remindersHtml from './reminders.html';
import trackerEditorHtml from './tracker-editor.html';
import contentEditorHtml from './content-editor.html';
import adminHtml from './admin.html';
import requirementsHtml from '../company/hub/templates/hub/requirements.html';
import companyEditorHtml from '../company/hub/templates/hub/company_editor.html';
import operationsHtml from './operations.html';
const templates={submissionsHtml,progressFormHtml,progressRequestsHtml,assuranceImportHtml,receivedImportHtml,companyEditorHtml,operationsHtml,adminHtml,trackerEditorHtml,contentEditorHtml,remindersHtml,requirementsHtml};
export class M1State extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.application=new M1Application(ctx.storage,env,templates);}
 fetch(request){return this.application.fetch(request);}
 async tick(){await ensureModelAlarm(this.storage,this.application.env.FORMA_SYNC_ENABLED==='true');return this.application.tick();}
 async assuranceTick(){if(this.application.env.FORMA_SYNC_ENABLED==='true')return syncIssues(this.application.env);}
 async progressMailTick(){return progressMailTick(this.application.env);}
 async midpTick(){if(this.application.env.FORMA_SYNC_ENABLED==='true')return syncTidpBatch(this.application.env);}
 alarm(){const env=this.application.env;return runModelAlarm(this.storage,env.FORMA_SYNC_ENABLED==='true',()=>syncModelSources(env,false,36),()=>nextModelSyncAt(env));}
}
const state=env=>env.PROJECT_STATE.get(env.PROJECT_STATE.idFromName('m1'));
export default {fetch:async(request,env)=>{const r=await state(env).fetch(request);const h=new Headers(r.headers);h.set('X-M1-Worker','2026-11-26-code-impact');return new Response(r.body,{status:r.status,headers:h});},scheduled:(event,env,ctx)=>ctx.waitUntil(Promise.allSettled([state(env).tick(),state(env).midpTick(),state(env).progressMailTick(),...(event.scheduledTime%300000===0?[state(env).assuranceTick()]:[])]))};
