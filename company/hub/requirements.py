import json
from pathlib import Path
from datetime import date
from urllib.parse import urlsplit
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from .auth import identity, allowed
from .models import Requirement, RequirementEvent, Snapshot

SCHEMA=json.loads(Path(__file__).with_name('requirements-schema.json').read_text(encoding='utf8'))

def assets():
    snapshot=Snapshot.objects.filter(key='knowledge').first()
    return snapshot.data.get('scope',{}).get('rows',[]) if snapshot else []

def permitted(user, data, scope):
    return (data.get('scopeId')=='*' or any(a['id']==data.get('scopeId') for a in scope)) and allowed(user,data.get('scopeId'),data.get('discipline'))

def validate(data,user,scope):
    if not isinstance(data,dict):raise ValueError('Check the requirement fields.')
    out={}
    for field in SCHEMA['fields']:
        value=data.get(field['key'],'')
        if not isinstance(value,str) or len(value)>field['max']:raise ValueError(field['label']+' is too long.')
        value=value.strip();out[field['key']]=value
        if field.get('required') and not value:raise ValueError('Fill in '+field['label'].lower()+'.')
        if field.get('options') and value and value not in field['options']:raise ValueError('Choose a valid '+field['label'].lower()+'.')
    if out['discipline'] not in SCHEMA['disciplines'] or not permitted(user,out,scope):raise ValueError('This asset and discipline are outside your editing scope.')
    if out['reference']:
        url=urlsplit(out['reference'])
        if url.scheme!='https' or not url.netloc or url.username or url.password:raise ValueError('Use an HTTPS reference link without credentials.')
    if out['dueDate']:
        try:
            if date.fromisoformat(out['dueDate']).isoformat()!=out['dueDate']:raise ValueError()
        except ValueError:raise ValueError('Choose a valid needed-by date.')
    out['status']=data.get('status') or 'Draft'
    if out['status'] not in SCHEMA['statuses']:raise ValueError('Choose a valid status.')
    return out

def serial(row):
    return {'id':str(row.id),'revision':row.revision,'data':row.data,'createdAt':row.created_at.isoformat(),'createdBy':row.created_by,'updatedAt':row.updated_at.isoformat(),'updatedBy':row.updated_by}

@ensure_csrf_cookie
def workspace(request):
    return render(request,'hub/requirements.html')

def api(request,ident=None,comments=False):
    user=identity(request)
    if not user:return JsonResponse({'error':'Sign in with an approved Autodesk account.'},status=401)
    scope=assets()
    if request.method=='GET':
        if ident:
            row=Requirement.objects.filter(pk=ident).first()
            if not row or not permitted(user,row.data,scope):return JsonResponse({'error':'Requirement not found in your scope.'},status=404)
            return JsonResponse({'row':serial(row),'events':[e.data for e in row.events.order_by('-id')[:150]]})
        return JsonResponse({'user':user,'schema':SCHEMA,'assets':[{'id':a['id'],'label':a.get('zone','')+' · '+a['name']+' · '+(a.get('proposed') or a.get('code',''))} for a in scope if user['owner'] or '*' in user['assets'] or a['id'] in user['assets']], 'rows':[serial(r) for r in Requirement.objects.order_by('-created_at') if permitted(user,r.data,scope)],'dashboardUrl':settings.PUBLIC_URL,'ownerUrl':'/admin/login/'})
    if request.method!='POST':return JsonResponse({'error':'Action not available.'},status=405)
    try:
        if len(request.body)>35000:raise ValueError('The changes are too large.')
        payload=json.loads(request.body)
        if not isinstance(payload,dict):raise ValueError('Check the request.')
        with transaction.atomic():
            if comments:
                row=Requirement.objects.filter(pk=ident).first()
                if not row or not permitted(user,row.data,scope):raise ValueError('Requirement not found in your scope.')
                text=payload.get('text')
                if not isinstance(text,str) or not text.strip() or len(text)>3000:raise ValueError('Enter a comment up to 3,000 characters.')
                event={'kind':'comment','by':user['email'],'at':timezone.now().isoformat(),'text':text.strip()}
                RequirementEvent.objects.create(requirement=row,data=event)
                return JsonResponse(event)
            if ident:raise ValueError('Use the register save action.')
            revision=payload.get('revision')
            if type(revision)!=int or revision<0:raise ValueError('Reload the register before saving.')
            data=validate(payload.get('data'),user,scope)
            old=Requirement.objects.select_for_update().filter(pk=payload['id']).first() if payload.get('id') else None
            if payload.get('id') and not old:raise ValueError('Requirement not found.')
            if old and not permitted(user,old.data,scope):raise ValueError('Requirement is outside your scope.')
            if (old.revision if old else 0)!=revision:raise ValueError('Someone saved a newer version. Reload before saving.')
            if not old and Requirement.objects.count()>=10000:raise ValueError('Register capacity reached. Contact the owner.')
            before=old.data if old else None
            row=old or Requirement(created_by=user['email'])
            row.data=data;row.revision=revision+1;row.updated_by=user['email'];row.save()
            changed=[k for k in data if (before or {}).get(k)!=data[k]]
            RequirementEvent.objects.create(requirement=row,data={'kind':'updated' if before else 'created','at':timezone.now().isoformat(),'by':user['email'],'revision':row.revision,'changed':changed,'before':before,'after':data})
            return JsonResponse(serial(row))
    except (ValueError,TypeError,KeyError,ValidationError) as exc:return JsonResponse({'error':str(exc)},status=400)
