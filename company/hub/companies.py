"""Owner-managed display assignments; these never change delivery scope or ACC access."""
import json
import re
from pathlib import Path
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render,redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET,require_http_methods
from .models import Snapshot
from .plan_assets import plan_assets

def defaults(): return json.loads(Path(__file__).with_name('company-defaults.json').read_text(encoding='utf8'))
def settings():
    row=Snapshot.objects.filter(key='companies').first()
    return row.data if row else defaults()
def assets():
    row=Snapshot.objects.filter(key='knowledge').first()
    return plan_assets(row.data.get('scope',{}).get('rows',[]) if row else [])
def validate(p,available):
    if not isinstance(p,dict) or type(p.get('revision')) is not int or p['revision']<0 or not isinstance(p.get('companies'),list) or not 1<=len(p['companies'])<=100 or not isinstance(p.get('assignments'),list) or len(p['assignments'])>500: raise ValueError('Check the company settings.')
    ids,names,seen=set(),set(),set();valid={a['id'] for a in available};companies=[];assignments=[]
    for c in p['companies']:
        if not isinstance(c,dict) or not isinstance(c.get('id'),str) or not re.fullmatch(r'[-a-z0-9]{1,64}',c['id']) or not isinstance(c.get('name'),str) or not c['name'].strip() or len(c['name'])>100 or not isinstance(c.get('color'),str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',c['color']) or c['id'] in ids or c['name'].strip().lower() in names: raise ValueError('Each company needs a unique name and valid colour.')
        ids.add(c['id']);names.add(c['name'].strip().lower());companies.append({'id':c['id'],'name':c['name'].strip(),'color':c['color'].lower()})
    for a in p['assignments']:
        if not isinstance(a,dict) or not isinstance(a.get('assetId'),str) or a['assetId'] not in valid or a['assetId'] in seen or not isinstance(a.get('companyId'),str) or a['companyId'] not in ids or not isinstance(a.get('role'),str) or len(a['role'])>250: raise ValueError('Choose an in-scope asset and an existing company.')
        seen.add(a['assetId']);assignments.append({'assetId':a['assetId'],'companyId':a['companyId'],'role':a['role'].strip()})
    return {'revision':p['revision']+1,'companies':companies,'assignments':assignments}
def assignment(asset,config):
    original=asset.get('appendixParty') or asset.get('party') or 'To confirm'
    assigned=next((a for a in config['assignments'] if a['assetId']==asset['id']),None)
    original_id={'ARX':'arx','ATM':'atm','ARX/ATM (Interfacing Only)':'interface'}.get(original)
    company=next((c for c in config['companies'] if c['id']==assigned['companyId']),None) if assigned else next((c for c in config['companies'] if (c['id']==original_id if original_id else c['name']==original)),None)
    return {'party':company['name'] if company else original,'color':company['color'] if company else None,'appendixParty':original,'deliveryRole':assigned['role'] if assigned else ''}
def owner(req): return req.user.is_authenticated and req.user.is_superuser
@require_GET
def public(req): return JsonResponse(settings())
@ensure_csrf_cookie
@require_GET
def workspace(req):
    if not owner(req): return redirect('/admin/login/?next=/admin/companies')
    return render(req,'hub/company_editor.html')
@require_http_methods(['GET','PUT'])
def api(req):
    if not owner(req): return JsonResponse({'error':'Owner sign-in required.'},status=401)
    available=assets()
    if req.method=='GET': return JsonResponse({'settings':settings(),'assets':available})
    try:
        if len(req.body)>50000: raise ValueError('The request is too large.')
        p=json.loads(req.body)
        with transaction.atomic():
            Snapshot.objects.get_or_create(key='companies',defaults={'data':defaults()})
            row=Snapshot.objects.select_for_update().get(key='companies')
            if p.get('revision')!=row.data['revision']: return JsonResponse({'error':'Company settings changed. Reload before saving.'},status=409)
            row.data=validate(p,available);row.save()
        return JsonResponse(row.data)
    except (ValueError,TypeError,AttributeError): return JsonResponse({'error':'Check the company names, colours and asset assignments.'},status=400)
