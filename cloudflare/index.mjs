import {DurableObject} from 'cloudflare:workers';
import {M1Application} from '../application.mjs';
import remindersHtml from './reminders.html';
import trackerEditorHtml from './tracker-editor.html';
import contentEditorHtml from './content-editor.html';
import adminHtml from './admin.html';
import requirementsHtml from '../company/hub/templates/hub/requirements.html';
const templates={adminHtml,trackerEditorHtml,contentEditorHtml,remindersHtml,requirementsHtml};
export class M1State extends DurableObject {constructor(ctx,env){super(ctx,env);this.application=new M1Application(ctx.storage,env,templates);}fetch(request){return this.application.fetch(request);}tick(){return this.application.tick();}}
const state=env=>env.PROJECT_STATE.get(env.PROJECT_STATE.idFromName('m1'));
export default {fetch:(request,env)=>state(env).fetch(request),scheduled:(event,env,ctx)=>ctx.waitUntil(state(env).tick())};
