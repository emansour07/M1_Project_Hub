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
    if scope_id!='pending':p[1]='SCOPE';p[3]=scope_id+'::TRF' if p[3]=='TRF' else scope_id
    if p[2]=='ARX':p[2]='SAP'
    if p[6] in ['BNM/BGM','BNM','BGM']:p[6]='BNM'
    return '-'.join(p)
def file_format(name):
    ext=name.rsplit('.',1)[-1].lower()
    return 'native' if ext in ['rvt','dwg'] else ext if ext in FORMATS else None
def read(key,default=None):
    s=Snapshot.objects.filter(key=key).first()
    return s.data if s else default
def excluded(row):
    return str(row.get('name','')).upper().split('-')[3:4]==['A51'] or row.get('scopeId')=='Island-A51'

def coordination_asset(row):
    if re.fullmatch(r'M1-121-PAR-P02-42-(?:BM012-B(?:NM/BGM|NM|GM)-ZZ-901001|BM019-B(?:NM/BGM|NM|GM)-ZZ-900001|BM036-B(?:NM/BGM|NM|GM)-ZZ-901001)(?:-R\d+)?(?:\.(?:RVT|DWG|NWC|IFC|DWFX))?',str(row.get('name','')),re.I):return {'id':'Mainland-SL1-SL2','code':'SL1 + SL2','name':'SL1 + SL2 station complex','zone':'Mainland','sharedAssets':['Mainland-SL1','Mainland-SL2'],'assignmentEvidence':'Owner-confirmed shared SL1 + SL2 group. Source IFC content spans the station complex; each model is counted once.'}
    base=re.sub(r'-R\d+$','',re.sub(r'\.(RVT|DWG|NWC|IFC|DWFX)$','',str(row.get('name','')).upper()))
    return {'id':'Island-wide','code':'Island-wide','name':'Island-wide coordination','zone':'Island','areaWide':True} if base=='M1-102-HES-XXX-42-BM100-BFM-XX-900001' else None

def receipt_hint(row):
    p=str(row.get('name','')).upper().split('-')
    if len(p)<6 or excluded(row):return None
    code=p[3];context=' '.join([str(row.get('description','')),str(row.get('source','')),*row.get('folderPath',[])])
    aliases={'MW1':'Mainland-WT1','MW2':'Mainland-WT2','SWP':'Mainland-SP','TP1':'Subsea-SS1','TP2':'Subsea-SS2'}
    if code in aliases:
        zone=aliases[code].split('-')[0]
        if (p[1]=='102' and zone!='Island') or (p[1]=='121' and zone!='Mainland'):return None
        return aliases[code]
    zone='Island' if p[1]=='102' else 'Mainland' if p[1]=='121' else 'Mainland' if re.search(r'\bMainland\b|\b121[- ]',context) else 'Island' if re.search(r'\bIsland\b|\b102[- ]',context) else None
    if not zone:return None
    if code=='TRF' and p[5]=='BM015':return zone+'-EW-ROD'
    if code not in ['XXX','YYY','ZZZ']:return None
    category='EW-GRD' if re.search(r'EARTHWORK|GRADING|SITE.CLEARANCE',context,re.I) else 'EW-ROD' if re.search(r'ROADS?|FENCING|TRAFFIC',context,re.I) else 'EW-LAN' if re.search(r'SOFTSCAPE|HARDSCAPE|LANDSCAPE',context,re.I) else 'EW-UTL' if re.search(r'UTILIT|SEWAGE.?NETWORK|STORM.?NETWORK',context,re.I) or p[5]=='BM037' else None
    return zone+'-'+category if category else None

def asset(row,scope):
    if excluded(row):return None
    wide=coordination_asset(row)
    if wide:return wide
    hint=receipt_hint(row)
    if hint:
        a=next((a for a in scope if a['id']==hint),None)
        if a:return a
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
        ids.add(r['id'])
        if excluded(r):continue
        a=asset(r,scope)
        pending=not a and data.get('scopeReviewed') is True and r.get('assetAssignmentPending') is True and r['scopeId']=='pending'
        if pending:a={'id':'pending','code':'Unassigned','name':'Asset assignment pending','zone':'Area to confirm'}
        if not a or (a['id']!=r['scopeId'] and not (data.get('scopeReviewed') and r.get('assetAssignmentPending') and r['scopeId']=='pending')):continue
        rows.append({**{k:r[k] for k in ['id','name','description','source','discipline','revision','scopeId']},'scopeId':a['id'],'asset':a.get('proposed') or a['code'],'assetName':a['name'],'zone':a['zone'],'assetAssignmentPending':pending,'areaWide':a.get('areaWide',False),'sharedAssets':a.get('sharedAssets',[]),
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
        if r.get('assetAssignmentPending'):
            n=None;status='Asset assignment pending'
            for f in formats.values():f['matches']=[];f['state']='Not checked'
        result[key]={**r,'key':key,'source':[r['source']],'formats':formats,'accFormats':n,'status':status}
    return list(result.values())
def resolve_rows(rows,scope):
    result=[]
    for r in rows:
        if excluded(r):continue
        if re.match(r'^M1-102-HES-XXX-42-BM046-B(?:NM/BGM|NM|GM)-MP-90100[012](?:-|\.|$)',r['name'],re.I):r={**r,'discipline':'Sewage (Wet Utilities)','contentEvidence':'Source IFC project and building: Sewage P10.2 NEW; BM046 picklist conflicts with model content'}
        if re.match(r'^M1-121-PAR-XXX-42-BM036-B(?:NM/BGM|NM|GM)-ZZ-901002(?:-|\.|$)',r['name'],re.I):r={**r,'assignmentComment':'Asset confirmation required: the IFC building is named WATER PUMP STATION, but does not identify WP1, WT1 or WT2. The similarly numbered P01 model is a different file named MAINLAND CAMP. Kept pending at the owner’s request.'}
        a=asset(r,scope)
        if r.get('assetAssignmentPending') and a:
            result.append({**r,'scopeId':a['id'],'asset':a.get('proposed') if a.get('proposed') not in [None,'XXX','YYY','ZZZ'] else a['code'],'assetName':a['name'],'zone':a['zone'],'assetAssignmentPending':False,'areaWide':a.get('areaWide',False),'sharedAssets':a.get('sharedAssets',[]),'assignmentEvidence':a.get('assignmentEvidence','Original code, source TIDP and model description')})
        elif r.get('assetAssignmentPending') or (a or {}).get('id')==r['scopeId']:result.append(r)
    return result

def reference_scoped(file,scope):
    if excluded(file):return None
    a=asset({**file,'source':' / '.join(file.get('folderPath',[])),'description':file.get('description','')},scope)
    return {**file,'scopeId':a['id'],'scopeAsset':a.get('proposed') or a['code'],'scopeName':a['name'],'areaWide':a.get('areaWide',False),'sharedAssets':a.get('sharedAssets',[])} if a else scoped(file,scope)

def retain_reference(files,scope,now):
    """Retain only reference models needed by the imported scoped expectations."""
    data=read('received-input',{'rows':[]});keys={model_key(r['name'],r['scopeId']) for r in resolve_rows(data['rows'],scope) if not r.get('assetAssignmentPending')}
    selected=[f for raw in files if (f:=reference_scoped(raw,scope)) and f['source']=='reference' and model_key(f['name'],f['scopeId']) in keys and file_format(f['name'])]
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
    rows=resolve_rows(data.get('rows',[]),scope)
    return JsonResponse({'sourceName':data.get('sourceName','M1_Models_Received.xlsx'),'sourceCheckedAt':data.get('sourceCheckedAt'),'checkedAt':reference.get('checkedAt'),'checking':False,'rows':compare(rows,reference.get('files',[]),reference.get('checkedAt'))})
