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
const templates={receivedImportHtml,companyEditorHtml,operationsHtml,adminHtml,trackerEditorHtml,contentEditorHtml,remindersHtml,requirementsHtml};
export class M1State extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.application=new M1Application(ctx.storage,env,templates);}
 fetch(request){return this.application.fetch(request);}
 async tick(){await ensureModelAlarm(this.storage,this.application.env.FORMA_SYNC_ENABLED==='true');return this.application.tick();}
 alarm(){const env=this.application.env;return runModelAlarm(this.storage,env.FORMA_SYNC_ENABLED==='true',()=>syncModelSources(env,false,36),()=>nextModelSyncAt(env));}
}
const state=env=>env.PROJECT_STATE.get(env.PROJECT_STATE.idFromName('m1'));
export default {fetch:(request,env)=>state(env).fetch(request),scheduled:(event,env,ctx)=>ctx.waitUntil(state(env).tick())};
