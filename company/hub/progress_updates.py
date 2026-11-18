"""Scoped team progress forms and owner-controlled requests for the company server."""
import json
import re
import uuid
import hashlib
from datetime import datetime
from zoneinfo import ZoneInfo
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render,redirect
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET,require_http_methods
from . import auth
from .models import Snapshot,TrackerDraft,Editor,Outbox
from .tracker import editable
from .workbooks import LEAD

DEFAULTS={'revision':0,'paused':True,'recipients':[],'sender':'eslam.mansour@arx.ing','subject':'M1 — weekly model progress update','message':'Please update the progress of your assigned models: delivery status, LOG, LOI, overall completion, target date and any blocker. Submit all your changes together using the form below.'}

def simple_columns(columns):
    return [c for c in columns if c['key'] in ['deliveryStatus','overallCompletion','targetDate','blocker'] or not c.get('hidden') and re.fullmatch(r'(LOG|LOI)\s*%',c['label'],re.I)]

def tracker_data():
    s=Snapshot.objects.filter(key='tracker').first()
    if not s:raise ValueError('The tracker is awaiting synchronization.')
    data={**s.data};data['columns']=s.data['columns']+[c for c in LEAD if not any(x['key']==c['key'] for x in s.data['columns'])]
    return data

def config():
    s=Snapshot.objects.filter(key='progress-requests').first()
    return {**DEFAULTS,**(s.data if s else {}),'connected':bool(settings.M1_MAIL_ENABLED),'schedule':'Wednesday · 2:00 PM · Asia/Dubai'}

@ensure_csrf_cookie
@require_GET
def form_page(req):
    from django.template.loader import render_to_string
    from django.http import HttpResponse
    return HttpResponse(render_to_string('hub/progress_form.html').replace('href="/admin/login"','href="/admin/login/?next=/progress-update"'))

@ensure_csrf_cookie
@require_GET
def requests_page(req):
    user=auth.identity(req)
    if not user or not user['owner']:return redirect('/admin/login/?next=/admin/progress-requests')
    return render(req,'hub/progress_requests.html')

def draft_json(d):return {'id':str(d.id),'rowId':d.row_id,'status':d.status,'changes':d.changes,'updatedAt':int(d.created_at.timestamp()*1000),'email':d.editor}

def submit(user,data,p):
    version=data.get('source',{}).get('versionId') or data.get('source',{}).get('version')
    if not version or p.get('sourceVersion')!=version:raise ValueError('The tracker changed or is not loaded. Reload the form before submitting.')
    items=p.get('rows')
    if not isinstance(items,list) or not 1<=len(items)<=100:raise ValueError('Submit between 1 and 100 changed models.')
    seen=set();ids=set();prepared=[];cols=simple_columns(data['columns'])
    for item in items:
        row=next((r for r in data['rows'] if r['id']==item.get('rowId')),None)
        ident=uuid.UUID(item.get('requestId',''));changes=item.get('changes')
        if not row or row['id'] in seen or ident in ids or not isinstance(changes,dict) or not changes:raise ValueError('Check the model selection and changes.')
        seen.add(row['id']);ids.add(ident);clean={}
        for key,value in changes.items():
            col=next((c for c in cols if c['key']==key),None)
            if not col or not editable(user,row,col):raise ValueError('This field or model is outside your editing assignment.')
            if value is None or value=='':clean[key]=None;continue
            if col['type']=='percent':
                if type(value) not in [int,float] or not 0<=value<=1:raise ValueError('Enter a percentage from 0 to 100.')
            elif col['type']=='date':
                if not isinstance(value,str) or datetime.strptime(value,'%Y-%m-%d').date().isoformat()!=value:raise ValueError('Enter a valid date.')
            elif col['type']=='status':
                if value not in ['Not started','Active','On hold','Complete']:raise ValueError('Choose a delivery status.')
            elif not isinstance(value,str) or len(value)>2000:raise ValueError('Keep comments under 2,000 characters.')
            clean[key]=value.strip() if isinstance(value,str) else value
        prepared.append((ident,row,clean))
    saved=[]
    with transaction.atomic():
        for ident,row,changes in prepared:
            old=TrackerDraft.objects.filter(pk=ident).first()
            if old:
                if old.editor!=user['email'] or old.row_id!=row['id'] or old.source_version!=str(version) or old.changes!=changes:raise ValueError('Submission reference already used. Reload before making another update.')
                saved.append(old);continue
            saved.append(TrackerDraft.objects.create(id=ident,editor=user['email'],row_id=row['id'],scope_id=row['scopeId'],model_name=row['name'],source_version=str(version),changes=changes))
    return {'saved':len(saved),'drafts':[draft_json(d) for d in saved]}

def request_settings(p):
    emails=set(Editor.objects.filter(active=True).values_list('email',flat=True))
    if type(p.get('revision')) is not int or type(p.get('paused')) is not bool or not isinstance(p.get('recipients'),list) or len(p['recipients'])>100 or any(e not in emails for e in p['recipients']):raise ValueError('Select approved editor emails as team leads.')
    if not isinstance(p.get('subject'),str) or not p['subject'].strip() or len(p['subject'])>180 or re.search(r'[\r\n]',p['subject']) or not isinstance(p.get('message'),str) or not p['message'].strip() or len(p['message'])>4000:raise ValueError('Check the subject and message.')
    if not p['paused'] and (not settings.M1_MAIL_ENABLED or not p['recipients']):raise ValueError('Connect the mailbox and select team leads before resuming.')
    with transaction.atomic():
        row,_=Snapshot.objects.get_or_create(key='progress-requests',defaults={'data':DEFAULTS})
        row=Snapshot.objects.select_for_update().get(pk=row.pk)
        if row.data['revision']!=p['revision']:raise ValueError('Settings changed. Reload before saving.')
        row.data={**DEFAULTS,'revision':p['revision']+1,'paused':p['paused'],'recipients':sorted(set(p['recipients'])),'subject':p['subject'].strip(),'message':p['message'].strip()};row.save()
    return config()

def queue_requests(mode='weekly',request_id=None,now=None):
    cfg=config();now=(now or timezone.now()).astimezone(ZoneInfo('Asia/Dubai'))
    if mode=='weekly' and (cfg['paused'] or not cfg['connected'] or now.weekday()!=2 or now.hour<14):return 0
    if not cfg['connected']:raise ValueError('The ARX mailbox is not connected yet.')
    if mode=='manual':request_id=str(uuid.UUID(request_id or ''))
    if not cfg['recipients']:raise ValueError('Select team leads first.')
    data=tracker_data();queued=0
    for editor in Editor.objects.filter(active=True,email__in=cfg['recipients']):
        user={'owner':False,'assets':editor.assets,'disciplines':editor.disciplines}
        if not any(auth.allowed(user,r['scopeId'],r['discipline']) for r in data['rows']):continue
        recipient_key=hashlib.sha256(editor.email.encode()).hexdigest()[:20]
        existing=Outbox.objects.filter(key__startswith='progress:'+mode+':',key__endswith=':'+recipient_key)
        if mode=='weekly':existing=existing.filter(key__startswith='progress:weekly:'+now.date().isoformat()+':')
        else:existing=existing.filter(key__contains=':'+request_id+':')
        if existing.exists():continue
        key='progress:'+mode+':'+now.date().isoformat()+':'+str(cfg['revision'])+':'+(request_id or 'weekly')+':'+recipient_key
        body=cfg['message']+'\n\nOpen your assigned-model form:\n'+settings.PUBLIC_URL+'/progress-update\n\nSign in with your approved Autodesk email: '+editor.email+'\nYour updates are collected for owner review before Excel publication.'
        _,created=Outbox.objects.get_or_create(key=key,defaults={'recipient':editor.email,'sender':cfg['sender'],'subject':cfg['subject'],'body':body});queued+=created
    return queued

def mail_allowed(row):
    cfg=config();parts=row.key.split(':');today=timezone.now().astimezone(ZoneInfo('Asia/Dubai')).date().isoformat()
    return row.recipient in cfg['recipients'] and Editor.objects.filter(email=row.recipient,active=True).exists() and parts[3]==str(cfg['revision']) and (parts[1]!='weekly' or not cfg['paused'] and parts[2]==today)

@require_http_methods(['GET','POST','PUT'])
def api(req,action):
    user=auth.identity(req)
    if not user:return JsonResponse({'error':'Sign in with your approved Autodesk email, or use owner access.'},status=401)
    try:
        if action=='workspace' and req.method=='GET':
            data=tracker_data();rows=[r for r in data['rows'] if auth.allowed(user,r['scopeId'],r['discipline'])]
            drafts=TrackerDraft.objects.all() if user['owner'] else TrackerDraft.objects.filter(editor=user['email'])
            columns=[{**c,'editable':not c.get('readonly') and (user['owner'] or '*' in user['fields'] or c['key'] in user['fields'])} for c in simple_columns(data['columns'])]
            return JsonResponse({'user':user,'date1904':bool(data.get('date1904')),'sourceVersion':data['source'].get('versionId') or data['source'].get('version'),'source':data['source'],'columns':columns,'rows':[{**r,'formulaFields':r.get('formulaFields',[])} for r in rows],'drafts':[draft_json(d) for d in drafts.order_by('-created_at')[:500]],'approvalUrl':'/editor','dashboardUrl':settings.PUBLIC_URL})
        if len(req.body)>250000:raise ValueError('Submission is too large.')
        if action=='submit' and req.method=='POST':return JsonResponse(submit(user,tracker_data(),json.loads(req.body)))
        if not user['owner']:return JsonResponse({'error':'Owner access required.'},status=403)
        if action=='requests' and req.method=='PUT':return JsonResponse(request_settings(json.loads(req.body)))
        if action=='send' and req.method=='POST':return JsonResponse({'queued':queue_requests('manual',json.loads(req.body).get('requestId'))})
        if action=='requests' and req.method=='GET':
            data=tracker_data();editors=[]
            for e in Editor.objects.filter(active=True):
                ds=TrackerDraft.objects.filter(editor=e.email);last=ds.order_by('-created_at').first()
                editors.append({'email':e.email,'models':sum(auth.allowed({'owner':False,'assets':e.assets,'disciplines':e.disciplines},r['scopeId'],r['discipline']) for r in data['rows']),'pending':ds.filter(status='pending').count(),'lastSubmission':int(last.created_at.timestamp()*1000) if last else 0})
            history=[{'email':r.recipient,'mode':r.key.split(':')[1],'day':r.key.split(':')[2],'state':{'sent':'accepted','pending':'queued','failed':'needs_check'}.get(r.state,r.state),'updatedAt':int((r.sent_at or r.created_at).timestamp()*1000),'detail':r.error} for r in Outbox.objects.filter(key__startswith='progress:').order_by('-created_at')[:100]]
            return JsonResponse({'settings':config(),'editors':editors,'history':history,'formUrl':settings.PUBLIC_URL+'/progress-update'})
        return JsonResponse({'error':'Not found'},status=404)
    except (ValueError,TypeError,KeyError,AttributeError):return JsonResponse({'error':'Check the submission, tracker version and your permitted fields. Reload if the tracker has changed.'},status=400)
