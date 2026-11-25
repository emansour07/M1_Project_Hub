"""Owner-published external logs; source Excel files remain read-only."""
import io
import json
import re
import time
import zipfile
from datetime import date, datetime, timezone, timedelta
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from openpyxl import load_workbook
from .models import Snapshot

STAGES={'arxSapac':'ARX → SAPAC','sapacMace':'SAPAC → MACE'}
FIELDS='name date reference status workflowStatus revision'.split()
def text(v):return '' if v is None else str(v).strip()
def key(v):return re.sub(r'[-_]R\d{1,3}$','',re.sub(r'\.(PDF|RVT|IFC|NWC|NWD|DWFX|DWG|DXF|DGN|DOCX?|XLSX?)$','',re.split(r'[/\\]',text(v))[-1].upper()))
def day(v):
    if v is None or v=='':return None
    try:return date.fromisoformat(str(v)).isoformat()
    except (ValueError,TypeError):raise ValueError('Use valid submission dates.')
def validate(data):
    if not isinstance(data,dict) or data.get('stage') not in STAGES or not isinstance(data.get('rows'),list) or not 0<len(data['rows'])<=15000:raise ValueError('Choose a stage and a non-empty log with up to 15,000 entries.')
    asof=day(data.get('asOf'));source=text(data.get('source'))
    if not asof or asof>datetime.now(timezone(timedelta(hours=4))).date().isoformat() or not source or len(source)>250:raise ValueError('Confirm the log date and filename.')
    rows=[];seen=set();void=duplicate=missing=0
    for raw in data['rows']:
        if not isinstance(raw,dict):raise ValueError('Invalid log entry.')
        r={k:day(raw.get(k)) if k=='date' else text(raw.get(k)) for k in FIELDS};r['sourceRow']=raw.get('sourceRow') if isinstance(raw.get('sourceRow'),int) else len(rows)+1
        if not r['name'] or any(isinstance(v,str) and len(v)>500 for v in r.values()):raise ValueError('Invalid document fields.')
        if re.search(r'\bVOID(?:ED)?\b',r['workflowStatus'],re.I):void+=1;continue
        if not r['date']:missing+=1
        elif r['date']>asof:raise ValueError('Submission date is after the log date: '+r['name'])
        identity=tuple(r[k].upper() if k=='name' else r[k] for k in ['name','date','reference','revision','status','workflowStatus'])
        if identity in seen:duplicate+=1;continue
        seen.add(identity);rows.append(r)
    if not rows:raise ValueError('No non-void documents found. The saved log is unchanged.')
    result=dict(stage=data['stage'],source=source,asOf=asof,basis='latest',rows=rows,voidCount=void,duplicateCount=duplicate,missingDates=missing)
    if len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode())>1700000:raise ValueError('The normalized log exceeds 1.7 MB.')
    return result
def match(entries,report):
    index={};groups={};unmatched=[];ambiguous=[]
    for e in entries:index.setdefault(key(e['name']),[]).append(e)
    for r in report.get('rows',[]):
        found=index.get(key(r['name']),[])
        if not found:unmatched.append(r);continue
        if len(found)!=1:ambiguous.append({**r,'candidates':[{k:c.get(k) for k in ['id','name','sheet','row','discipline']}|{'asset':c.get('scopeId')} for c in found]});continue
        groups.setdefault(found[0]['id'],[]).append(r)
    byid={}
    for ident,rows in groups.items():
        dates=sorted(r['date'] for r in rows if r.get('date'));last=dates[-1] if dates else None;latest=[r for r in rows if r.get('date')==last];events={}
        for r in rows:
            if not r.get('date'):continue
            e=events.setdefault((r['date'],r.get('reference') or r.get('revision')),dict(date=r['date'],reference=r.get('reference',''),revisions=[],statuses=[]))
            for singular,plural in [('revision','revisions'),('status','statuses')]:
                if r.get(singular) and r[singular] not in e[plural]:e[plural].append(r[singular])
        byid[ident]=dict(first=dates[0] if dates else None,latest=last,date=last,status=' / '.join(dict.fromkeys(r['status'] for r in latest if r.get('status'))),references=', '.join(dict.fromkeys(r['reference'] for r in latest if r.get('reference'))),history=sorted(events.values(),key=lambda r:(r['date'],r['reference'])),entries=len(rows))
    return dict(byId=byid,matched=len(byid),unmatched=unmatched,ambiguous=ambiguous)
def reports():return [s.data for s in Snapshot.objects.filter(key__in=['submissions/'+k for k in STAGES]).order_by('key') if s.data.get('stage') in STAGES]
def attach(snapshot):
    entries=snapshot.get('entries',[]);joined=[(r,match(entries,r)) for r in reports()];internal=Snapshot.objects.filter(key='snapshot').first();reviews=(internal.data.get('current') or internal.data).get('reviews',[]) if internal else [];internalrows=[]
    for r in reviews:
        if re.search(r'\bVOID(?:ED)?\b',r.get('status',''),re.I):continue
        created=r.get('created');created=datetime.fromtimestamp(created/1000,timezone(timedelta(hours=3))).date().isoformat() if isinstance(created,(int,float)) else None
        internalrows.extend(dict(name=f['name'],date=created,reference=r['id'],revision=f.get('version',''),status=f.get('status','')) for f in r.get('files',[]))
    internalmatch=match(entries,{'rows':internalrows})['byId'];out=[]
    for e in entries:
        submissions={r['stage']:m['byId'][e['id']] for r,m in joined if e['id'] in m['byId']}
        out.append({**e,'submissions':submissions,'internalSubmission':internalmatch.get(e['id']),**{k+'Date':v['date'] for k,v in submissions.items()}})
    return {**snapshot,'entries':out,'submissionLogs':[{**{k:r.get(k) for k in ['stage','source','asOf','basis','revision','updatedAt']},'matched':m['matched'],'unmatched':len(m['unmatched']),'ambiguous':len(m['ambiguous'])} for r,m in joined]}
@ensure_csrf_cookie
@require_GET
def workspace(req):return render(req,'hub/submissions.html') if req.user.is_authenticated and req.user.is_superuser else redirect('/admin/login/?next=/admin/submissions')
def api(req,action):
    if not(req.user.is_authenticated and req.user.is_superuser):return JsonResponse({'error':'Owner access required.'},status=403)
    if action=='workspace' and req.method=='GET':return JsonResponse({'stages':STAGES,'reports':[{**{k:v for k,v in r.items() if k!='rows'},'count':len(r['rows'])} for r in reports()]})
    if req.method!='POST':return JsonResponse({'error':'Method not allowed.'},status=405)
    try:
        if len(req.body)>4000000:raise ValueError('Use a file smaller than 4 MB.')
        if action=='workbook':
            with zipfile.ZipFile(io.BytesIO(req.body)) as z:
                if len(z.infolist())>3000 or sum(i.file_size for i in z.infolist())>30000000:raise ValueError('Workbook is too large when expanded.')
            book=load_workbook(io.BytesIO(req.body),read_only=True,data_only=True)
            try:
                if len(book.worksheets)>20 or any((s.max_row or 0)>10000 or (s.max_column or 0)>80 for s in book):raise ValueError('Use a log with at most 20 sheets, 10,000 entries and 80 columns.')
                sheets=[{'name':s.title,'rows':[[v.isoformat()[:10] if isinstance(v,(date,datetime)) else v if v is not None else '' for v in row] for row in s.iter_rows(values_only=True)]} for s in book]
            finally:book.close()
            return JsonResponse({'sheets':sheets})
        data=json.loads(req.body);p=validate(data);midp=Snapshot.objects.filter(key='midp').first();entries=midp.data.get('entries',[]) if midp else [];m=match(entries,p)
        if not entries:raise ValueError('Load the MIDP before importing a log.')
        with transaction.atomic():
            record,_=Snapshot.objects.get_or_create(key='submissions/'+p['stage'],defaults={'data':{}});record=Snapshot.objects.select_for_update().get(pk=record.pk);old=record.data;revision=old.get('revision',0)
            if action=='preview':
                previous=match(entries,old)['byId'];return JsonResponse({**{k:m[k] for k in ['matched','unmatched','ambiguous']},'baseRevision':revision,**{k:p[k] for k in ['voidCount','duplicateCount','missingDates']},'removedMatches':len(set(previous)-set(m['byId'])),'sample':[{**{k:e.get(k) for k in ['name','discipline']},'asset':e.get('scopeId'),**m['byId'][e['id']]} for e in entries if e['id'] in m['byId']][:30]})
            if action!='import':return JsonResponse({'error':'Action not available.'},status=404)
            if data.get('baseRevision')!=revision:raise ValueError('This log changed. Preview it again.')
            if old and p['asOf']<old['asOf']:raise ValueError('An older log cannot replace the current log.')
            if not m['matched']:raise ValueError('No unique MIDP matches. Check the document column.')
            p.update(revision=revision+1,updatedAt=int(time.time()*1000));record.data=p;record.save()
        return JsonResponse({'saved':True,'stage':p['stage'],'revision':p['revision']})
    except (ValueError,TypeError,KeyError,zipfile.BadZipFile) as e:return JsonResponse({'error':str(e)},status=400)
