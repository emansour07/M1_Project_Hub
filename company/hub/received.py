"""Read-only workbook receipt expectations, reconciled with the ACC reference scan."""
import json
import re
import time
from collections import defaultdict
from django.http import JsonResponse
from django.shortcuts import render,redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET,require_http_methods
from .models import Snapshot
from .workbooks import scoped

FORMATS=['native','nwc','ifc','dwfx']
def model_key(name,scope_id):
    base=re.sub(r'[.-](RVT|DWG|NWC|IFC|DWFX)$','',name.strip().upper()).rstrip('-')
    p=re.sub(r'-R\d+$','',base).split('-')
    if len(p)!=9 or p[0]!='M1':return None
    p[1]='SCOPE';p[3]=scope_id
    if p[2]=='ARX':p[2]='SAP'
    if p[6] in ['BNM/BGM','BNM','BGM']:p[6]='BNM'
    return '-'.join(p)
def file_format(name):
    ext=name.rsplit('.',1)[-1].lower()
    return 'native' if ext in ['rvt','dwg'] else ext if ext in FORMATS else None
def read(key,default=None):
    s=Snapshot.objects.filter(key=key).first()
    return s.data if s else default
def asset(row,scope):
    p=row['name'].split('-');parcel=p[1]
    if re.fullmatch(r'\d{3}',parcel) and parcel not in ['102','121']:return None
    context=row['source'].replace('MIDP M1 - ','');hint=re.search(r'(?:^|\W)(102|121)(?:-|\W)',context)
    result=scoped({'name':row['name'],'description':row['description'],'folderPath':[context],'parcel':hint[1] if hint and not parcel.isdigit() else parcel},scope)
    return next((a for a in scope if result and a['id']==result['scopeId']),None)
def validate(data,scope):
    if not isinstance(data,dict) or not isinstance(data.get('rows'),list) or len(data['rows'])>5000 or not isinstance(data.get('sourceCheckedAt'),(int,float)):raise ValueError('Select a prepared model-receipt analysis.')
    rows=[];ids=set()
    for r in data['rows']:
        if not isinstance(r,dict) or any(not isinstance(r.get(k),str) or len(r[k])>1000 for k in ['id','name','description','source','discipline','revision','scopeId']) or not model_key(r['name'],r['scopeId']) or r['id'] in ids:raise ValueError('Invalid or repeated model entry.')
        ids.add(r['id']);a=asset(r,scope)
        if not a or a['id']!=r['scopeId']:continue
        rows.append({**{k:r[k] for k in ['id','name','description','source','discipline','revision','scopeId']},'asset':a.get('proposed') or a['code'],'assetName':a['name'],'zone':a['zone'],
            'formats':{f:{'sourceAvailable':r.get('formats',{}).get(f,{}).get('sourceAvailable') is True,'workbookReceived':r.get('formats',{}).get(f,{}).get('workbookReceived') is True} for f in FORMATS}})
    if not rows:raise ValueError('No confirmed scoped models were found.')
    return {'sourceName':'M1_Models_Received.xlsx','sourceCheckedAt':data['sourceCheckedAt'],'importedAt':int(time.time()*1000),'rows':rows}
def compare(rows,files,checked):
    index=defaultdict(list)
    for f in files:
        fmt=file_format(f['name']);key=model_key(f['name'],f['scopeId'])
        if fmt and key:index[(key,fmt)].append({k:f.get(k) for k in ['id','name','folderId','updatedAt','version']})
    result={}
    for r in rows:
        key=model_key(r['name'],r['scopeId'])
        if key in result:
            if r['source'] not in result[key]['source']:result[key]['source'].append(r['source'])
            continue
        formats={}
        for fmt in FORMATS:
            f=r['formats'][fmt];matches=index[(key,fmt)];state='In ACC' if matches else 'Not checked' if not checked else 'Source available' if f['sourceAvailable'] else 'Not found'
            formats[fmt]={**f,'matches':matches,'state':state}
        n=sum(bool(f['matches']) for f in formats.values());source=any(f['sourceAvailable'] for f in formats.values())
        status='Not checked' if not checked else 'All formats in ACC' if n==4 else 'Partial in ACC' if n else 'Source only' if source else 'Not found in ACC'
        result[key]={**r,'key':key,'source':[r['source']],'formats':formats,'accFormats':n,'status':status}
    return list(result.values())
def retain_reference(files,scope,now):
    """Retain only reference models needed by the imported scoped expectations."""
    data=read('received-input',{'rows':[]});keys={model_key(r['name'],r['scopeId']) for r in data['rows'] if asset(r,scope)}
    selected=[f for f in files if f['source']=='reference' and model_key(f['name'],f['scopeId']) in keys and file_format(f['name'])]
    Snapshot.objects.update_or_create(key='received-reference',defaults={'data':{'checkedAt':now,'files':selected}})
def owner(req):return req.user.is_authenticated and req.user.is_superuser
@ensure_csrf_cookie
@require_GET
def workspace(req):
    if not owner(req):return redirect('/admin/login/?next=/admin/received')
    return render(req,'hub/received_import.html')
@require_http_methods(['PUT'])
def import_analysis(req):
    if not owner(req):return JsonResponse({'error':'Owner access required.'},status=403)
    try:
        if len(req.body)>1500000:raise ValueError('The file is too large.')
        policy=read('knowledge',{}).get('scope',{}).get('rows',[])
        data=validate(json.loads(req.body),policy)
        Snapshot.objects.update_or_create(key='received-input',defaults={'data':data})
        return JsonResponse({'saved':True,'count':len(data['rows'])})
    except (ValueError,TypeError,KeyError,AttributeError):return JsonResponse({'error':'Check the prepared analysis and current asset scope.'},status=400)
@require_GET
def public(req):
    data=read('received-input',{});reference=read('received-reference',{});scope=read('knowledge',{}).get('scope',{}).get('rows',[])
    rows=[r for r in data.get('rows',[]) if (asset(r,scope) or {}).get('id')==r['scopeId']]
    return JsonResponse({'sourceName':data.get('sourceName','M1_Models_Received.xlsx'),'sourceCheckedAt':data.get('sourceCheckedAt'),'checkedAt':reference.get('checkedAt'),'checking':False,'rows':compare(rows,reference.get('files',[]),reference.get('checkedAt'))})
