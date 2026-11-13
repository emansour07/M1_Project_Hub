import hashlib
import json
import re
from datetime import timedelta
from pathlib import Path
from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import JsonResponse, HttpResponse, HttpResponseForbidden, FileResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie
from . import auth
from .aps import APS
from .forms import AccessRequestForm
from .models import AccessRequest, AccessProfile, ContentSection, Snapshot, RateBucket, UploadDestination, UploadIntent, Masterplan, AssetHotspot
from .services import decide_access, queue_request_notification, audit

def owner(req): return req.user.is_authenticated and req.user.is_superuser
def owner_required(fn):
    def wrapped(req,*a,**kw):
        if not owner(req): return redirect('/admin/login/?next='+req.path)
        return fn(req,*a,**kw)
    return wrapped

def limited(req, purpose, limit, minutes=60):
    # IT must normalize REMOTE_ADDR at its trusted reverse proxy; never trust arbitrary X-Forwarded-For.
    key = purpose+':'+hashlib.sha256((settings.SECRET_KEY+req.META.get('REMOTE_ADDR','')).encode()).hexdigest()
    now = timezone.now()
    with transaction.atomic():
        row,_ = RateBucket.objects.get_or_create(key=key,defaults={'expires_at':now+timedelta(minutes=minutes)})
        RateBucket.objects.filter(pk=key,expires_at__lte=now).update(count=0,expires_at=now+timedelta(minutes=minutes))
        return not bool(RateBucket.objects.filter(pk=key,count__lt=limit).update(count=F('count')+1))

@require_http_methods(['GET','POST'])
def access_request(req):
    form = AccessRequestForm(req.POST or None)
    if req.method == 'POST':
        if limited(req,'access',5): return render(req,'hub/access.html',{'form':form,'error':'Please try again later.'},status=429)
        if form.is_valid():
            with transaction.atomic():
                # Public responses do not disclose whether another person has requested access.
                existing = AccessRequest.objects.filter(email=form.cleaned_data['email'],status__in=['pending','approved','provisioning']).exists()
                if not existing:
                    row = form.save(commit=False)
                    row.requested_role = row.profile.name
                    row.save()
                    queue_request_notification(row)
                    audit('public','access.requested',row.id)
            return render(req,'hub/access.html',{'submitted':True})
    return render(req,'hub/access.html',{'form':form})

@owner_required
@require_http_methods(['GET','POST'])
def access_review(req, ident):
    row = get_object_or_404(AccessRequest.objects.select_related('profile'),pk=ident)
    error = None
    if req.method == 'POST':
        try:
            if req.POST.get('action') not in ('approve','reject'): raise ValueError('Choose Approve or Reject.')
            row = decide_access(ident,req.user.email,req.POST['action']=='approve')
        except ValueError as exc: error = str(exc)
    return render(req,'hub/access_review.html',{'entry':row,'error':error,'enabled':settings.M1_PROVISION_ENABLED})

@ensure_csrf_cookie
@require_GET
def dashboard(req):
    path = settings.REPO_DIR/'pages/index.html'
    if not path.exists(): return HttpResponse('Build the frontend before starting the server.',status=503)
    html = path.read_text(encoding='utf8')
    # Build assets share this origin; API credentials never go to JavaScript.
    html = re.sub(r'(src|href)="((?:style\.css|config\.js|core\.js|app\.js|assets/)[^"]*)"',r'\1="/static/\2"',html)
    html = html.replace('/static/config.js','/runtime-config.js')
    return HttpResponse(html)

@require_GET
def config(req):
    value = {'apiOrigin':settings.PUBLIC_URL,'companyServer':True,'projectId':settings.M1_PROJECT_ID,'accOrigin':'https://acc.autodesk.eu',
        'publicUrl':settings.PUBLIC_URL,'folderUrl':'https://acc.autodesk.eu/docs/files/projects/'+settings.M1_PROJECT_ID+'?folderUrn=urn%3Aadsk.wipemea%3Afs.folder%3Aco.6tClIOPzQGyEeWnblrUTng','folderLabel':'Original design reference'}
    return HttpResponse('window.M1_CONFIG = '+json.dumps(value)+';',content_type='text/javascript')

@require_GET
def snapshot(req, key):
    if key not in ['snapshot','models','knowledge','midp','tracker','originals','checker']: return JsonResponse({'error':'Not found'},status=404)
    s = Snapshot.objects.filter(key=key).first()
    if not s: return JsonResponse({'error':'The company data connection is awaiting its first complete synchronization.'},status=503)
    return JsonResponse(s.data)

@require_GET
def content(req):
    return JsonResponse({'sections':[{'id':str(s.id),'area':s.area,'title':s.title,'body':s.body,
        'links':list(s.links.values('label','url'))} for s in ContentSection.objects.prefetch_related('links')]})

@require_http_methods(['GET','POST'])
def sharing(req):
    user = auth.identity(req)
    if not user: return render(req,'hub/sharing.html',{'signin':True})
    destinations = [d for d in UploadDestination.objects.filter(active=True,verified=True) if auth.allowed(user,d.asset_id,d.discipline)]
    error, preview, done = None,None,None
    if req.method == 'POST':
        try:
            d = next((d for d in destinations if str(d.id)==req.POST.get('destination')),None)
            if not d: raise ValueError('Select one of your assigned Shared destinations.')
            if req.POST.get('action') == 'preview':
                name = req.POST.get('filename','').strip()
                if not re.fullmatch(r'[^/\\\x00-\x1f]{1,240}\.(?:rvt|nwc|ifc|dwfx|dwg)',name,re.I): raise ValueError('Choose a native model or exchange model filename without a folder path.')
                from .workbooks import scoped,discipline
                from .sync import model
                policy=Snapshot.objects.filter(key='knowledge').first()
                matched=scoped({'name':name,'folderPath':d.folder_path.split(' / ')},policy.data['scope']['rows'] if policy else [])
                if not matched or matched.get('mappingConflict') or matched['scopeId']!=d.asset_id or discipline(name)!=d.discipline or not model({'name':name}):
                    raise ValueError('The model filename must identify the selected asset and discipline. Check its naming before uploading.')
                client = APS()
                client.verify_destination(d.folder_id,d.root)
                existing = client.find_file(d.folder_id,name)
                tip = client.tip(existing['id']) if existing else None
                preview = UploadIntent.objects.create(editor_email=user['email'],destination=d,filename=name,
                    item_id=existing['id'] if existing else '',expected_version=tip['id'] if tip else '',expires_at=timezone.now()+timedelta(minutes=15))
                audit(user['email'],'upload.preview',preview.id,destination=d.folder_id,name=name)
            elif req.POST.get('action') == 'upload':
                if not settings.M1_UPLOAD_ENABLED: raise ValueError('Direct upload is awaiting company Autodesk write-access configuration. Use the folder link for now.')
                intent = get_object_or_404(UploadIntent,pk=req.POST.get('intent'),editor_email=user['email'],destination=d)
                file = req.FILES.get('model')
                if not file or file.name != intent.filename or file.size <= 0 or file.size > 2*1024**3: raise ValueError('Choose the same file, up to 2 GB.')
                if intent.item_id and req.POST.get('confirm_version')!='yes': raise ValueError('Confirm creating a new version of the existing file.')
                if not UploadIntent.objects.filter(pk=intent.pk,state='preview',expires_at__gt=timezone.now()).update(state='uploading'): raise ValueError('This preview expired or was already used.')
                committing = False
                try:
                    client = APS(('data:read','data:write','data:create'))
                    client.verify_destination(d.folder_id,d.root)
                    current = client.find_file(d.folder_id,intent.filename)
                    current_tip = client.tip(current['id'])['id'] if current else ''
                    if current_tip != intent.expected_version: raise ValueError('The ACC file changed. Preview the destination again.')
                    storage = client.upload_storage(d.folder_id,intent.filename,file)
                    current = client.find_file(d.folder_id,intent.filename)
                    if (client.tip(current['id'])['id'] if current else '') != intent.expected_version: raise ValueError('Someone updated this file during upload. Preview again before creating a version.')
                    committing = True
                    client.commit_file(d.folder_id,intent.filename,storage,intent.item_id or None)
                    intent.state = 'complete'
                    done = 'Your model has been uploaded to the selected M1 Shared folder.'
                    audit(user['email'],'upload.complete',intent.id,name=intent.filename,folder=d.folder_id)
                except Exception:
                    intent.state = 'verify_in_acc' if committing else 'failed'
                    raise
                finally:
                    intent.save(update_fields=['state'])
            else: raise ValueError('Choose Preview first.')
        except Exception as exc: error = str(exc) if isinstance(exc,ValueError) else 'The upload could not be confirmed. Check the selected ACC folder before retrying.'
    return render(req,'hub/sharing.html',{'destinations':destinations,'preview':preview,'error':error,'done':done})

@require_GET
def masterplans(req):
    from .companies import settings as company_settings, assignment
    companies=company_settings()
    locations_snapshot=Snapshot.objects.filter(key='locations').first()
    locations=locations_snapshot.data if locations_snapshot else {'rows':[],'source':None}
    scope = Snapshot.objects.filter(key='knowledge').first()
    from .plan_assets import plan_assets
    visual_assets=plan_assets(scope.data.get('scope',{}).get('rows',[]) if scope else [])
    allowed = {r['id'] for r in visual_assets}
    entries = (Snapshot.objects.filter(key='midp').first())
    entries = entries.data.get('entries',[]) if entries else []
    from .completeness import calculate
    from .models import CompletenessPolicy
    scores=calculate(entries,CompletenessPolicy.objects.first())
    result = []
    for p in Masterplan.objects.filter(approved=True):
        rows=[]
        for h in p.hotspots.filter(asset_id__in=allowed):
            visual=next(a for a in visual_assets if a['id']==h.asset_id)
            visual={**visual,**assignment(visual,companies)}
            deliverables = [e for e in entries if e.get('scopeId')==h.asset_id]
            phases = sorted({e.get('projectStage') for e in deliverables if e.get('projectStage')})
            rows.append({'id':h.id,'assetId':h.asset_id,'name':h.name,'code':h.code,'x':h.x,'y':h.y,'width':h.width,'height':h.height,'function':h.function,'contextOnly':visual.get('contextOnly',False),'party':visual.get('party'),'color':visual.get('color'),'appendixParty':visual.get('appendixParty'),'deliveryRole':visual.get('deliveryRole'),
                'phases':phases,'models':sum(e.get('category')=='Models' for e in deliverables),'drawings':sum(e.get('category')=='Drawings' for e in deliverables),
                'completeness':scores.get(h.asset_id,{}).get('percentage'),'approval':scores.get(h.asset_id),
                'location':next((r for r in locations['rows'] if r['id']==h.asset_id),None)})
        wide=[]
        for a in scope.data.get('scope',{}).get('rows',[]) if scope else []:
            if a.get('zone')==p.zone and a.get('code','').startswith('EW-'):
                wide.append({'name':a['name'],'code':a['code'],'scopeId':a['id'],'approval':scores.get(a['id'])})
        result.append({'zone':p.zone,'title':p.title,'image':'/api/masterplans/'+str(p.id)+'/image','sourceUrl':p.source_url,'assets':rows,'wideScope':wide})
    return JsonResponse({'plans':result,'locations':locations})

@require_GET
def plan_image(req,ident):
    p = get_object_or_404(Masterplan,pk=ident,approved=True)
    return FileResponse(p.image.open('rb'),content_type='image/png' if p.image.name.lower().endswith('.png') else 'image/jpeg')

@owner_required
@require_http_methods(['GET','POST'])
def map_editor(req,ident):
    p = get_object_or_404(Masterplan,pk=ident)
    scope = Snapshot.objects.filter(key='knowledge').first()
    from .plan_assets import plan_assets
    assets = [a for a in plan_assets(scope.data.get('scope',{}).get('rows',[]) if scope else []) if a.get('zone')==p.zone and not a.get('code','').startswith('EW-')]
    error = None
    if req.method == 'POST':
        try:
            a = next((a for a in assets if a['id']==req.POST.get('asset')),None)
            if not a: raise ValueError('Choose an asset from the approved M1 scope.')
            h = AssetHotspot(plan=p,asset_id=a['id'],name=a['name'],code=a.get('proposed') or a.get('code',''),x=float(req.POST['x']),y=float(req.POST['y']),width=float(req.POST.get('width',5)),height=float(req.POST.get('height',4)),function=req.POST.get('function',''))
            h.full_clean()
            AssetHotspot.objects.update_or_create(plan=p,asset_id=a['id'],defaults={k:getattr(h,k) for k in ['name','code','x','y','width','height','function']})
        except Exception: error = 'Select an asset and click a valid position on the plan.'
    return render(req,'hub/map_editor.html',{'plan':p,'assets':assets,'error':error})

@owner_required
def owner_plan_image(req,ident):
    p = get_object_or_404(Masterplan,pk=ident)
    return FileResponse(p.image.open('rb'),content_type='image/png' if p.image.name.lower().endswith('.png') else 'image/jpeg')

@require_GET
def orgchart(req):
    path = settings.MEDIA_ROOT/'orgchart.svg'
    if not path.exists(): return JsonResponse({'error':'Organisation chart has not been imported.'},status=404)
    return FileResponse(path.open('rb'),content_type='image/svg+xml')

@require_POST
def refresh(req,kind='project'):
    if limited(req,'refresh',10,1): return JsonResponse({'updating':True},status=202)
    from .jobs import queue_sync
    queue_sync()
    return JsonResponse({'updating':True},status=202)

@require_GET
def midp_export(req):
    if limited(req,'export',30):return JsonResponse({'error':'Please try again later.'},status=429)
    from .workbooks import SOURCES,midp_entries
    from .exports import export_midp
    try:
        policy=Snapshot.objects.get(key='knowledge').data['scope']['rows']
        data,tip=APS().download(SOURCES['midp'])
        rows=midp_entries(data,policy)
        value=export_midp(data,rows,req.GET.get('start'),req.GET.get('end'),req.GET)
        response=HttpResponse(value,content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition']='attachment; filename="M1_MIDP_'+req.GET['start']+'_'+req.GET['end']+'.xlsx"'
        return response
    except ValueError as exc:return JsonResponse({'error':str(exc)},status=400)
    except Exception:return JsonResponse({'error':'The MIDP export is unavailable. Please try again after refresh.'},status=503)

@require_GET
def asset_completeness(req):
    from .completeness import calculate
    from .models import CompletenessPolicy
    s=Snapshot.objects.filter(key='midp').first()
    return JsonResponse({'assets':calculate(s.data.get('entries',[]) if s else [],CompletenessPolicy.objects.first())})

@require_http_methods(['GET','POST'])
def tracker_editor(req):
    from .tracker import DraftForm
    from .models import TrackerDraft
    user=auth.identity(req)
    if not user:return render(req,'hub/tracker_editor.html',{'signin':True})
    snap=Snapshot.objects.filter(key='tracker').first();data=snap.data if snap else {'rows':[],'columns':[]}
    rows=[r for r in data['rows'] if auth.allowed(user,r['scopeId'],r['discipline'])]
    ident=req.GET.get('row') or req.POST.get('row')
    row=next((r for r in rows if r['id']==ident),None)
    form=DraftForm(user,row,data['columns'],req.POST or None) if row else None
    saved=False
    if req.method=='POST' and form and form.is_valid():
        changes=form.changes(row,data['columns'])
        if changes:
            if req.POST.get('source_version')!=data.get('source',{}).get('versionId'):
                form.add_error(None,'The tracker changed while you were editing. Reload the row and try again.')
            else:
                draft=TrackerDraft.objects.create(editor=user['email'],row_id=row['id'],scope_id=row['scopeId'],model_name=row['name'],
                    source_version=data['source']['versionId'],changes=changes)
                audit(user['email'],'tracker.draft',draft.id,fields=list(changes))
                saved=True
    return render(req,'hub/tracker_editor.html',{'rows':rows,'row':row,'form':form,'saved':saved,'source_version':data.get('source',{}).get('versionId',''),
        'drafts':TrackerDraft.objects.filter(status='pending') if user['owner'] else TrackerDraft.objects.filter(editor=user['email']), 'owner':user['owner']})

@owner_required
@require_http_methods(['GET','POST'])
def tracker_approval(req,ident):
    from .models import TrackerDraft
    from .tracker import publish
    d=get_object_or_404(TrackerDraft,pk=ident);error=None
    if req.method=='POST':
        try:
            if req.POST.get('action')=='publish':publish(d.id,req.user.email)
            elif req.POST.get('action')=='reject':
                if not TrackerDraft.objects.filter(pk=d.pk,status='pending').update(status='rejected'):raise ValueError('The draft is no longer pending.')
                audit(req.user.email,'tracker.rejected',d.id)
            else:raise ValueError('Choose Publish or Reject.')
            d.refresh_from_db()
        except ValueError as exc:error=str(exc)
        except Exception:error='Publication could not be confirmed. Check the draft status and ACC before retrying.';d.refresh_from_db()
    return render(req,'hub/tracker_approval.html',{'draft':d,'error':error})

@owner_required
@require_GET
def tracker_preview(req,ident):
    from .models import TrackerDraft
    from .tracker import prepare
    d=get_object_or_404(TrackerDraft,pk=ident,status='pending')
    try:
        data,_=prepare(d)
        response=HttpResponse(data,content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition']='attachment; filename="M1_Tracker_Proposed.xlsx"'
        return response
    except ValueError as exc:return HttpResponse(str(exc),status=409)
    except Exception:return HttpResponse('Preview unavailable. Check the Autodesk connection.',status=503)

@owner_required
@require_http_methods(['GET','POST'])
def owner_home(req):
    from .services import sync_roles
    message=None
    if req.method=='POST' and req.POST.get('action')=='roles':
        try:message=f'{sync_roles()} actual M1 project roles loaded.'
        except Exception:message='Role synchronization is unavailable. Check the company Autodesk connection.'
    return render(req,'hub/owner.html',{'message':message})
