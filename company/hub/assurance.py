"""Read-only ACC Issues and owner-reviewed imported coordination reports."""
import io
import json
import time
import zipfile
import re
from urllib.parse import quote
from datetime import date, datetime
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from openpyxl import load_workbook
from .models import Snapshot
from .aps import APS, ProviderError
from .workbooks import scoped

FIELDS='id title status asset discipline owner created due closed updated test group model version element description url'.split()
DATES={'created','due','closed','updated'}
def now():return int(time.time()*1000)
def read(key,default=None):
    r=Snapshot.objects.filter(key='assurance/'+key).first()
    return r.data if r else default
def put(key,value):
    if value is None:Snapshot.objects.filter(key='assurance/'+key).delete()
    else:Snapshot.objects.update_or_create(key='assurance/'+key,defaults={'data':value})
def assets():
    r=Snapshot.objects.filter(key='knowledge').first()
    return [a for a in (r.data.get('scope',{}).get('rows',[]) if r else []) if a['id'].upper()!='ISLAND-A51']
def text(v):return '' if v is None else str(v).strip()
def day(v):
    if v is None or v=='':return None
    try:return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:raise ValueError('Use valid ISO dates (YYYY-MM-DD).')
def asset_for(v,scope):
    value=text(v).upper()
    match=[a for a in scope if a['id'].upper()==value]
    if match:return match[0]
    match=[a for a in scope if value and value in [text(c).upper() for c in [a.get('code'),a.get('proposed'),*a.get('aliases',[])]]]
    return match[0] if len(match)==1 else None
def link(v):
    from urllib.parse import urlsplit
    try:
        u=urlsplit(v)
        return u.scheme=='https' and u.hostname in ['acc.autodesk.com','acc.autodesk.eu','docs.b360.autodesk.com','docs.b360.eu.autodesk.com'] and not u.username and not u.password
    except ValueError:return False
def validate(data,scope):
    if not isinstance(data,dict) or data.get('kind') not in ['rfi','clashes','qaqc'] or not isinstance(data.get('rows'),list) or not 0<len(data['rows'])<=10000:raise ValueError('Select a non-empty report with up to 10,000 rows.')
    batch,source,asof=text(data.get('batch')),text(data.get('source')),day(data.get('asOf'))
    if not batch or len(batch)>120 or not source or len(source)>250 or not asof:raise ValueError('Supply a register name, source filename and report date.')
    if asof>date.today().isoformat():raise ValueError('Report date cannot be in the future.')
    rows=[];unmapped=[];seen=set()
    for i,raw in enumerate(data['rows'],1):
        if not isinstance(raw,dict):raise ValueError('Invalid row.')
        r={k:day(raw.get(k)) if k in DATES else text(raw.get(k)) for k in FIELDS}
        if any(isinstance(v,str) and len(v)>(3000 if k=='description' else 500) for k,v in r.items()):raise ValueError(f'Row {i} contains an oversized field.')
        if not all(r[k] for k in ['id','title','status']):raise ValueError(f'Row {i}: reference, title and status are required.')
        if data['kind']=='qaqc' and not all(r[k] for k in ['model','version']):raise ValueError('QA/QC records require the model filename and checked ACC version.')
        r.update(recordType='group' if raw.get('recordType')=='group' else 'clash',parentId=text(raw.get('parentId')),sourceRow=i)
        r['key']=json.dumps([r['test'],r['recordType'],r['id']] if data['kind']=='clashes' else [r['model'],r['version'],r['id']] if data['kind']=='qaqc' else [r['id']],ensure_ascii=False,separators=(',',':'))
        if r['key'] in seen:raise ValueError('Duplicate reference: '+r['id'])
        seen.add(r['key'])
        if r['url'] and not link(r['url']):raise ValueError('Only Autodesk ACC links can be saved.')
        a=asset_for(r['asset'] or data.get('scopeId'),scope)
        if not a:unmapped.append({'row':i,'id':r['id'],'asset':r['asset']});continue
        r.update(scopeId=a['id'],asset=a.get('proposed') or a['code'],assetName=a['name']);rows.append(r)
    if not rows:raise ValueError('No scoped records. Select an asset or map the Asset column.')
    result={'kind':data['kind'],'batch':batch,'source':source,'asOf':asof,'rows':rows,'unmapped':unmapped,'total':len(data['rows'])}
    if len(json.dumps(result).encode())>1700000:raise ValueError('Split the report into smaller scoped registers.')
    return result
def diff(old,p):
    previous={r['key']:r for r in (old or {}).get('rows',[])};added=changed=0
    for r in p['rows']:
        before=previous.pop(r['key'],None)
        if before is None:added+=1
        elif {**before,'sourceRow':0}!={**r,'sourceRow':0}:changed+=1
    return {'added':added,'changed':changed,'notInLatest':len(previous)}
def assessment_state(row,scan):
    if not scan or not scan.get('checkedAt'):return 'Current model version not checked'
    found=[f for g in scan.get('rows',[]) if g.get('scopeId')==row['scopeId'] for f in g.get('documents',[]) if text(f.get('name')).lower()==row['model'].lower()]
    if not found:return 'Model not found in latest folder scan'
    if len({f.get('id') for f in found})>1 or len({str(f.get('version')) for f in found})!=1:return 'Model/version match needs review'
    return 'Matches scanned ACC version' if str(found[0].get('version'))==row['version'] else 'Awaiting model check — ACC version changed'
def snapshot(owner=False):
    scope=assets();allowed={a['id'] for a in scope};reports=[]
    for r in read('reports',[]):reports.append({**r,'importedBy':None,'rows':[x for x in r['rows'] if x['scopeId'] in allowed]})
    scan=Snapshot.objects.filter(key='checker').first()
    for r in reports:
        if r['kind']=='qaqc':r['rows']=[{**x,'assessmentState':assessment_state(x,scan.data if scan else None)} for x in r['rows']]
    issues=read('issues',{'rows':[],'checkedAt':None,'pending':[],'unassigned':0});state=read('issue-state',{})
    return {'reports':reports,'issues':{**issues,'rows':[r for r in issues['rows'] if r['scopeId'] in allowed or r['scopeId']=='project-coordination'],'pending':issues.get('pending',[]) if owner else None},'issueState':{'checkedAt':state.get('checkedAt'),'error':state.get('error') if owner else 'The latest issue update is unavailable. The last complete check is retained.' if state.get('error') else None},'links':read('links',[]),'assets':scope if owner else None}
def issue_placements(raw,client,cache):
    def get(path):
        if path not in cache:
            try:cache[path]=client.call(path)
            except ProviderError as exc:
                if '(403)' not in str(exc) and '(404)' not in str(exc):raise
                cache[path]={'data':None}
        return cache[path]
    documents=[]
    for link in (raw.get('linkedDocuments') or [])[:8]:
        urn=re.sub(r'@\d+$','',str(link.get('urn') or ''))
        if not re.fullmatch(r'urn:adsk\.wip(?:emea|prod):dm\.lineage:[\w-]+',urn):continue
        base=f'/data/v1/projects/b.{settings.M1_PROJECT_ID.removeprefix("b.")}/'
        item=get(base+'items/'+quote(urn,safe='')).get('data')
        if not item:continue
        name=item.get('attributes',{}).get('displayName') or item.get('attributes',{}).get('name')
        if not name:continue
        folders=[];seen=set();parent=item.get('relationships',{}).get('parent',{}).get('data',{}).get('id')
        for _ in range(10):
            if not parent:break
            if parent in seen:raise ValueError('Repeated ACC placement folder.')
            seen.add(parent);folder=get(base+'folders/'+quote(parent,safe='')).get('data')
            if not folder:break
            label=folder.get('attributes',{}).get('displayName') or folder.get('attributes',{}).get('name')
            if label:folders.insert(0,label)
            parent=folder.get('relationships',{}).get('parent',{}).get('data',{}).get('id')
        documents.append({'id':urn,'name':name,'folderPath':folders})
    return documents

def issue_scope(raw,scope,documents):
    if documents and all(d['name'].lower().endswith('.nwd') and (re.search(r'-BFM-|fed(?:e)?rat(?:ed|ion)',d['name'],re.I) or any(re.search('federated models',p,re.I) for p in d['folderPath'])) for d in documents):
        return {'id':'project-coordination','code':'Project coordination — asset not assigned','name':'Project coordination — asset not assigned'}
    if documents:
        matches=[scoped(d,scope) for d in documents]
        ids={m['scopeId'] for m in matches if m}
        return next((a for a in scope if a['id'] in ids),None) if all(matches) and len(ids)==1 else None
    mapped=scoped({'name':raw.get('title',''),'description':raw.get('description',''),'folderPath':[raw.get('title') or '',raw.get('locationDetails') or '']},scope)
    found=next((a for a in scope if mapped and a['id']==mapped['scopeId']),None)
    if not found and not raw.get('linkedDocuments') and not re.search(r'\bA51\b',' '.join([raw.get('title') or '',raw.get('locationDetails') or '']),re.I):
        return {'id':'project-coordination','code':'Project coordination — asset not assigned','name':'Project coordination — asset not assigned'}
    return found

def placement_discipline(documents):
    names=set()
    for doc in documents:
        for folder in doc['folderPath']:
            label=re.sub(r'^\d+[._ -]*','',folder).strip().lower()
            if re.fullmatch(r'architecture|architectural|structure|structural|mechanical|electrical|civil|plumbing|fire ?fighting|landscape',label):names.add(label.replace('architectural','architecture').replace('structural','structure').capitalize())
    return next(iter(names)) if len(names)==1 else ''

def sync_issues(client=None):
    state=read('issue-state',{});at=now()
    if state.get('nextAttemptAt',0)>at:return {'cached':True}
    put('issue-state',{**state,'nextAttemptAt':at+60000})
    try:
        scope=assets()
        if not scope:raise ValueError('Load M1 asset scope before linking issues.')
        client=client or APS();placement_cache={};assignments=read('assignments',{});job=read('issue-job')
        if not job or job['startedAt']<at-1800000:job={'startedAt':at,'offset':0,'rows':[],'pending':[],'seen':[],'total':None,'unassigned':0}
        for _ in range(5):
            d=client.call(f'/construction/issues/v1/projects/{settings.M1_PROJECT_ID}/issues?limit=100&offset={job["offset"]}')
            result=d.get('results');total=d.get('pagination',{}).get('totalResults')
            if not isinstance(result,list) or not isinstance(total,int) or not 0<=total<=20000:raise ValueError('Incomplete ACC Issues response.')
            if job['total'] is not None and job['total']!=total:raise ValueError('Issues changed while scanning. Refresh to restart.')
            job['total']=total
            for raw in result:
                ident=text(raw.get('id'))
                if not ident or ident in job['seen']:raise ValueError('Repeated issue page.')
                job['seen'].append(ident);assignment=assignments.get(ident,{})
                if assignment.get('scopeId')=='exclude':continue
                documents=issue_placements(raw,client,placement_cache)
                found=next((a for a in scope if a['id']==assignment.get('scopeId')),None) if assignment.get('scopeId') else issue_scope(raw,scope,documents)
                if not found:
                    job['unassigned']+=1
                    if len(job['pending'])<200:job['pending'].append({'id':ident,'reference':text(raw.get('displayId')),'title':text(raw.get('title'))[:200],'model':'; '.join(d['name'] for d in documents)})
                    continue
                if found['id']=='project-coordination' and len(job['pending'])<200:job['pending'].append({'id':ident,'reference':text(raw.get('displayId')),'title':text(raw.get('title'))[:200],'model':'; '.join(d['name'] for d in documents)})
                job['rows'].append({'id':ident,'key':ident,'reference':text(raw.get('displayId')),'title':text(raw.get('title'))[:500],'status':text(raw.get('status')) or 'Unknown','scopeId':found['id'],'asset':found.get('proposed') or found['code'],'assetName':found['name'],'projectLevel':found['id']=='project-coordination','discipline':assignment.get('discipline') or placement_discipline(documents),'model':'; '.join(d['name'] for d in documents),'owner':text(raw.get('assignedTo')),'ownerType':text(raw.get('assignedToType')),'created':raw.get('createdAt'),'updated':raw.get('updatedAt'),'due':raw.get('dueDate'),'closed':raw.get('closedAt'),'description':text(raw.get('description'))[:3000],'url':f'https://acc.autodesk.eu/build/issues/projects/{settings.M1_PROJECT_ID}?issueId={ident}'})
            job['offset']+=len(result)
            if job['offset']>total or not result and job['offset']<total:raise ValueError('Incomplete issue page.')
            if job['offset']==total:
                put('issues',{'rows':job['rows'],'pending':job['pending'],'checkedAt':at,'unassigned':job['unassigned']});put('issue-job',None);put('issue-state',{'checkedAt':at,'nextAttemptAt':at+60000});return {'ok':True,'count':len(job['rows'])}
        put('issue-job',job);return {'updating':True}
    except (ValueError,ProviderError) as e:
        put('issue-job',None);put('issue-state',{**state,'error':str(e),'nextAttemptAt':at+60000});raise
@ensure_csrf_cookie
@require_GET
def workspace(req):
    return render(req,'hub/assurance_import.html') if req.user.is_authenticated and req.user.is_superuser else redirect('/admin/login/?next=/admin/assurance')
def api(req,action=''):
    owner=req.user.is_authenticated and req.user.is_superuser
    if not action and req.method=='GET':return JsonResponse(snapshot())
    if action=='refresh' and req.method=='POST':
        try:return JsonResponse(sync_issues())
        except (ValueError,ProviderError):return JsonResponse({'error':'ACC Issues could not be refreshed. The last complete check is retained.'},status=503)
    if not owner:return JsonResponse({'error':'Owner access required.'},status=403)
    if action=='workspace' and req.method=='GET':return JsonResponse(snapshot(True))
    if req.method!='POST':return JsonResponse({'error':'Action not available.'},status=405)
    try:
        if len(req.body)>4000000:raise ValueError('Use a report smaller than 4 MB.')
        if action=='workbook':
            with zipfile.ZipFile(io.BytesIO(req.body)) as z:
                if len(z.infolist())>3000 or sum(i.file_size for i in z.infolist())>30000000:raise ValueError('Workbook is too large when expanded.')
            book=load_workbook(io.BytesIO(req.body),read_only=True,data_only=True);sheets=[]
            try:
                for s in book.worksheets[:20]:sheets.append({'name':s.title,'rows':[[v.isoformat()[:10] if isinstance(v,(date,datetime)) else v if v is not None else '' for v in r] for r in s.iter_rows(max_row=min(s.max_row or 10050,10050),max_col=min(s.max_column or 80,80),values_only=True)]})
            finally:book.close()
            return JsonResponse({'sheets':sheets})
        data=json.loads(req.body);scope=assets()
        if action in ['preview','import']:
            prepared=validate(data,scope)
            with transaction.atomic():
                record,_=Snapshot.objects.get_or_create(key='assurance/reports',defaults={'data':[]})
                record=Snapshot.objects.select_for_update().get(pk=record.pk);reports=record.data
                old=next((r for r in reports if r['kind']==prepared['kind'] and r['batch']==prepared['batch']),None);revision=(old or {}).get('revision',0);delta=diff(old,prepared)
                if action=='preview':return JsonResponse({**prepared,'baseRevision':revision,'delta':delta})
                if data.get('baseRevision')!=revision:raise ValueError('This register changed. Preview the report again.')
                if old and prepared['asOf']<old['asOf']:raise ValueError('An older report cannot replace the current register.')
                prepared.pop('unmapped');prepared.update(revision=revision+1,importedAt=now(),importedBy=req.user.email,delta=delta,history=[*((old or {}).get('history',[])),{'asOf':prepared['asOf'],'source':prepared['source'],'at':now(),'count':len(prepared['rows']),'delta':delta}][-30:])
                record.data=[r for r in reports if r is not old]+[prepared];record.save();return JsonResponse({'saved':True,'report':prepared})
        if action=='assign':
            current=read('issues',{'rows':[],'pending':[]})
            if not any(r['id']==data.get('id') for r in current['rows']+current['pending']) or data.get('scopeId') not in ['exclude',*[a['id'] for a in scope]] or not isinstance(data.get('discipline'),str) or len(data['discipline'])>100:raise ValueError('Select a current issue and scoped asset.')
            assignments=read('assignments',{});assignments[data['id']]={'scopeId':data['scopeId'],'discipline':data['discipline']};put('assignments',assignments);put('issue-state',{});put('issue-job',None);return JsonResponse({'saved':True})
        if action=='link':
            if not any(r['id']==data.get('issueId') for r in snapshot()['issues']['rows']) or not any(r['kind']=='clashes' and r['batch']==data.get('batch') and any(x['key']==data.get('key') for x in r['rows']) for r in read('reports',[])):raise ValueError('Choose a saved clash and in-scope ACC issue.')
            links=[r for r in read('links',[]) if r['batch']!=data['batch'] or r['key']!=data['key']]
            if len(links)>=1000:raise ValueError('Link limit reached.')
            links.append({k:data[k] for k in ['batch','key','issueId']});put('links',links);return JsonResponse({'saved':True})
        return JsonResponse({'error':'Action not available.'},status=405)
    except (ValueError,TypeError,KeyError,zipfile.BadZipFile) as e:return JsonResponse({'error':str(e)},status=400)
