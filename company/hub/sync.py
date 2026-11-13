import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from django.conf import settings
from django.db import transaction
from .aps import APS, ROOTS, quote
from .models import Snapshot, UploadDestination
from .workbooks import sync_workbooks, scoped, discipline, model_key, book, text, source

REFERENCE='urn:adsk.wipemea:fs.folder:co.6tClIOPzQGyEeWnblrUTng'
REVIEW='urn:adsk.wipemea:fs.folder:co.kWJCSblxQaaYrIWQVDZeow'
ORIGINALS='urn:adsk.wipemea:fs.folder:co.ol6jt2GMQpCKRYKff6hhmA'
ext=lambda n:n.rsplit('.',1)[-1].lower()
stem=lambda n:n.rsplit('.',1)[0].upper()

def epoch(value):
    if not value:return None
    try:return int(datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000)
    except (ValueError,AttributeError):return None

def model(f):
    return ext(f['name']) in ['rvt','ifc','nwc','nwd','dwfx'] or (ext(f['name'])=='dwg' and (
        '-C3D-' in f['name'].upper() or discipline(f['name']) in ['Civil','Roads','Earthworks','Drainage','Utilities / marine']))

def check_name(name,mapping,rules):
    if not mapping or not rules.get('fields'):return {'state':'unchecked','issues':[],'suggestion':None}
    match=re.search(r'\.([A-Za-z0-9]+)$',name);base=name[:match.start()] if match else name
    parts=base.split('-');fixed=[p.upper() for p in parts];issues=[]
    def add(field,message,corrected=None):issues.append({'field':field,'message':message,'corrected':corrected})
    if not match:add('Extension','File extension is missing.')
    if len(parts) not in (9,10):return {'state':'warning','issues':[{'field':'Structure','message':'Use '+rules['pattern']+'.','corrected':None}],'suggestion':None}
    for p,f in zip(parts,fixed):
        if p!=f:add('Case','Use uppercase naming codes.',f)
    if fixed[0]!='M1':fixed[0]='M1';add('Project','Project code must be M1.','M1')
    if fixed[1]!='FXX':fixed[1]='FXX';add('Parcel','The second segment must be FXX.','FXX')
    for rule in rules['fields']:
        if fixed[rule['index']] not in {v['code'] for v in rule['values']}:add(rule['label'],f'{fixed[rule["index"]]} is not in the TIDP picklist.')
    asset=fixed[3];parcel=parts[1].upper()
    local=[m for m in mapping if not parcel.isdigit() or m['section'].replace('.','')==str(int(parcel))]
    if asset not in ['XXX','YYY','ZZZ'] and not any(m['proposed']==asset for m in local):
        candidates={m['proposed'] for m in local if m['existing']==asset}
        ambiguous=any(m.get('mappingPending') and m['existing']==asset or parcel=='FXX' and asset in m.get('ambiguous',[]) for m in local)
        if len(candidates)==1 and not ambiguous:
            fixed[3]=next(iter(candidates));add('Asset','Replace the existing code with '+fixed[3]+'.',fixed[3])
        else:add('Asset','Confirm the asset code against the scoped TIDP mapping.')
    if not re.fullmatch(r'\d{6}',fixed[8]):add('Number','Document number must have six digits.')
    if len(parts)==10 and not re.fullmatch(r'R\d{2}',fixed[9]):add('Revision','Use R followed by two digits; confirm the actual revision.')
    return {'state':'warning' if issues else 'pass','issues':issues,'suggestion':'-'.join(fixed)+match.group() if issues and match and all(i['corrected'] for i in issues) else None}

def crawl(client,scope):
    files=[];seen=set();queue=[(key,folder,[]) for key,folder in {**ROOTS,'review':REVIEW,'reference':REFERENCE}.items()]
    while queue:
        key,folder,trail=queue.pop(0)
        if (key,folder) in seen:raise ValueError('Repeated folder encountered; prior scan retained.')
        seen.add((key,folder))
        if len(seen)>10000:raise ValueError('Folder scan exceeded 10,000 folders.')
        for item in client.contents(folder):
            a=item.get('attributes',{});name=a.get('displayName') or a.get('name','')
            if item['type']=='folders':
                if key=='reference' and re.search(r'other[ _-]*assets',name,re.I):continue
                named=re.match(r'^(102|121)[ _-]([A-Z0-9]{2,5})(?:[ _-]|$)',name,re.I)
                if named and not scoped({'name':f'M1-{named[1]}-REF-{named[2]}-00-REF','folderPath':trail},scope):continue
                if not trail and re.fullmatch(r'[A-Z]{1,3}\d{1,2}',name,re.I) and not any(name.upper() in s['aliases'] for s in scope):continue
                queue.append((key,item['id'],trail+[name]));continue
            if item['type']!='items':continue
            detail=a.get('extension',{}).get('data',{})
            version=(item.get('_tip') or {}).get('attributes',{})
            f=scoped({'id':item['id'],'name':name,'source':key,'folderId':folder,'folderPath':trail,
                'description':detail.get('description') or '', 'descriptionRead':'description' in detail,
                'version':version.get('versionNumber'),'updatedAt':version.get('lastModifiedTime') or a.get('lastModifiedTime')},scope)
            if f and (key!='review' or model(f)):files.append(f)
    return files

def shared_checks(files,mapping,rules):
    groups=defaultdict(list)
    for f in files:
        if f['source'] in ROOTS:groups[(f['source'],f['folderId'],stem(f['name']))].append(f)
    rows=[]
    for (src,folder,name),variants in groups.items():
        formats={ext(f['name']) for f in variants};is_model=any(model(f) for f in variants)
        native=any(ext(f['name'])=='rvt' or ext(f['name'])=='dwg' and model(f) for f in variants)
        missing=[x for x in ['native','nwc'] if (not native if x=='native' else x not in formats)] if is_model else []
        counterparts=[f for f in variants if ext(f['name']) in ['rvt','dwg','nwc'] and model(f)]
        versions={str(f['version']) for f in counterparts if f.get('version') is not None}
        mismatch=is_model and len(versions)>1
        docs=[{**f,'naming':check_name(f['name'],mapping,rules),'descriptionState':('Present' if f['description'].strip() else 'Missing') if f['descriptionRead'] else 'Not checked'} for f in variants]
        for f in docs:
            if f.get('mappingConflict'):
                f['naming']['state']='warning';f['naming']['suggestion']=None
                f['naming']['issues'].append({'field':'Asset / folder','message':'Filename and folder identify different assets. Confirm the correct destination.','corrected':None})
        issues=[]
        if missing:issues.append('Missing formats')
        if mismatch:issues.append('Version mismatch')
        if any(f['descriptionState']=='Missing' for f in docs):issues.append('Missing description')
        if any(f['naming']['state']=='warning' for f in docs):issues.append('Naming')
        pending=any(f['descriptionState']=='Not checked' or f['naming']['state']=='unchecked' for f in docs) or is_model and any(f.get('version') is None for f in counterparts)
        first=variants[0]
        rows.append({'key':'|'.join([src,folder,name]),'name':name,'source':src,'folderId':folder,'folderPath':first['folderPath'],
            'scopeId':first['scopeId'],'scopeName':first['scopeName'],'discipline':discipline(first['name']),'model':is_model,
            'missing':missing,'versionMismatch':mismatch,'documents':docs,'issues':issues,'state':'Needs attention' if issues else 'Not fully checked' if pending else 'Passed'})
    return rows

def grouped_models(files):
    groups=defaultdict(list)
    for f in files:
        if model(f):groups[stem(f['name'])].append(f)
    output=[]
    for key,variants in groups.items():
        native=[f for f in variants if ext(f['name']) in ['rvt','dwg']]
        representative=min(native or variants,key=lambda f:epoch(f.get('updatedAt')) or 0)
        locations=[]
        for src,folder in sorted({(f['source'],f['folderId']) for f in variants}):
            members=[f for f in variants if f['source']==src and f['folderId']==folder];formats={ext(f['name']) for f in members}
            required=['native','nwc','ifc','dwfx'] if src=='review' else ['native','nwc']
            locations.append({'source':src,'folderId':folder,'folderPath':members[0]['folderPath'],'stage':'Review' if src=='review' else 'Shared','formats':sorted(formats),
                'missing':[x for x in required if (not formats.intersection(['rvt','dwg']) if x=='native' else x not in formats)]})
        output.append({**representative,'modelKey':key,'formats':sorted({ext(f['name']) for f in variants}),'variants':variants,'locations':locations})
    return output

def progress_data(files,tracker,midp,knowledge,now):
    developed=grouped_models([f for f in files if f['source'] in ROOTS or f['source']=='review'])
    groups={};known={}
    for r in tracker['rows']:known.setdefault(model_key(r),[]).append(r)
    def group(f):
        key=f['scopeId']+'|'+discipline(f['name'])
        if key not in groups:groups[key]={'asset':f['scopeAsset'],'assetName':f['scopeName'],'discipline':discipline(f['name']),'reference':0,'models':0,'drawings':0,'progressed':0,'expected':0}
        return groups[key]
    reference_seen=set()
    for f in files:
        if f['source']!='reference':continue
        k=stem(f['name']) if model(f) else f['id']
        if k in reference_seen:continue
        reference_seen.add(k);g=group(f);g['reference']+=1;g['models' if model(f) else 'drawings']+=1
    matched=set()
    for f in developed:
        key=model_key(f);matched.add(key);matches=known.get(key,[]);r=matches[0] if len(matches)==1 else None
        fields=r.get('fields',{}) if r else {}
        def percent(label):
            cols=[c for c in tracker['columns'] if re.fullmatch(label+r'\s*%',c['label'],re.I) and not c.get('hidden')]
            if len(cols)!=1:return None
            value=fields.get(cols[0]['key'])
            if value is None or value=='':return None
            try:
                n=float(str(value).replace('%',''));n=n if '%' in str(value) or n>1 else n*100
                return n if 0<=n<=100 else None
            except ValueError:return None
        stamp=epoch(f.get('updatedAt'))
        f.update({'asset':f['scopeAsset'],'assetName':f['scopeName'],'discipline':discipline(f['name']),'log':percent('LOG'),'loi':percent('LOI'),
            'updateState':'Date unavailable' if stamp is None or stamp>now else 'Over 7 days' if now-stamp>7*86400000 else 'Updated this week'})
        group(f)['progressed']+=1
    for r in midp['entries']:
        if r['category']=='Models':group(r)['expected']+=1
    for r in tracker['rows']:
        r['files']=[{'name':f['name'],'id':f['id'],'folderId':f['folderId'],'updatedAt':f['updatedAt'],'formats':f['formats']} for f in developed if model_key(f)==model_key(r)]
    return {'baseline':{'assets':[],'disciplines':[],'requirements':[]},'scan':{'complete':True,'checkedAt':now,'availability':list(groups.values()),'files':developed,
        'outstanding':[r for r in tracker['rows'] if not r['missingFromTracker'] and model_key(r) not in matched], 'unmapped':{'reference':0,'progress':0,'scope':0},'trackerCount':len(tracker['rows'])},
        'formatCheckedAt':now,'mappingSource':knowledge['mapping']['source'],'trackerSource':tracker['source'],'baselineSource':midp['source'],'checking':{'active':False,'failed':False}}

def original_data(client,scope,files,now):
    workbooks=[i for i in client.contents(ORIGINALS) if i['type']=='items' and (i['attributes'].get('displayName') or i['attributes'].get('name','')).lower().endswith('.xlsx')]
    if len(workbooks)!=4:raise ValueError('Exactly four original MIDPs are required.')
    sources=[];expected={};available=defaultdict(list)
    for f in files:
        if f['source']=='reference' and model(f):available[model_key(f)].append({k:f[k] for k in ['id','name','folderId','updatedAt']})
    for item in workbooks:
        data,tip=client.download(item['id']);src=source(tip,item['id']);sources.append(src);w=book(data)
        for sheet in w:
            nc=dc=None
            for n,row in enumerate(sheet.values,1):
                if nc is None:
                    nc=next((i for i,v in enumerate(row[:3]) if re.fullmatch(r'DELIVERABLE\s*\(TITLE\)',text(v),re.I)),None)
                    dc=next((i for i,v in enumerate(row[:3]) if text(v).upper()=='DESCRIPTION'),None)
                    continue
                name=text(row[nc]);parts=name.upper().split('-')
                if len(parts)<7 or parts[0]!='M1' or parts[6] not in ['BNM','C3D','BFM']:continue
                r=scoped({'name':name,'description':text(row[dc]) if dc is not None else '', 'folderPath':[sheet.title],'sheet':sheet.title,'row':n},scope)
                if r:
                    k=model_key(r);expected[k]={**r,'key':k,'discipline':discipline(name),'sourceId':item['id'],'sourceName':src['name'],
                        'matches':available[k],'availability':'Available' if available[k] else 'Not found'}
        w.close()
    return {'complete':True,'checkedAt':now,'sources':sources,'rows':list(expected.values())}

def list_results(client,path):
    rows=[];seen=set()
    for offset in range(0,20000,50):
        page=client.call(path+('&' if '?' in path else '?')+f'limit=50&offset={offset}')
        batch=page.get('results')
        if not isinstance(batch,list):raise ValueError('Invalid Autodesk page.')
        for r in batch:
            key=r.get('id') or r.get('urn')
            if not key or key in seen:raise ValueError('Duplicate or invalid Autodesk records.')
            seen.add(key);rows.append(r)
        total=page.get('pagination',{}).get('totalResults')
        if total is not None and len(rows)==total:return rows
        if total is not None and (len(rows)>total or not batch):raise ValueError('Autodesk changed during synchronization.')
        if total is None and len(batch)<50 and not page.get('pagination',{}).get('nextUrl'):return rows
    raise ValueError('Autodesk list exceeded its limit.')

def review_data(client,scope,now):
    base='/construction/reviews/v1/projects/'+settings.M1_PROJECT_ID
    reviews=[]
    for r in list_results(client,base+'/reviews?sort=sequenceId%20asc'):
        if re.search(r'VOID|ARCHIVED',r.get('status',''),re.I):continue
        path=base+'/reviews/'+quote(r['id']);w=client.call(path+'/workflow');versions=list_results(client,path+'/versions')
        files=[]
        for f in versions:
            name=(f.get('reviewContent') or {}).get('name') or f.get('name','');m=re.search(r'[?&]version=(\d+)',f.get('urn') or '')
            item=scoped({'name':name,'folderPath':[r['name']],'path':'','version':m[1] if m else '', 'status':(f.get('approveStatus') or {}).get('label',''),'comments':'','description':''},scope)
            if item:files.append(item)
        if not files:continue
        nxt=r.get('nextActionBy') or {};c=nxt.get('candidates') or {};people=(nxt.get('claimedBy') or [])+(c.get('users') or [])+(c.get('roles') or [])+(c.get('companies') or [])
        step=next((s for s in w['steps'] if s['id']==r.get('currentStepId')),None)
        reviews.append({'id':str(r['sequenceId']),'autodeskId':r['id'],'name':r['name'],'round':'—','status':r['status'].upper(),
            'workflow':w['name'],'discipline':w['name'],'owner':', '.join(dict.fromkeys(p.get('name') or p.get('autodeskId','') for p in people)),
            'initiator':(r.get('createdBy') or {}).get('name',''),'approver':(r.get('approvedBy') or {}).get('name',''),'due':epoch(r.get('currentStepDueDate')),
            'created':epoch(r.get('createdAt')),'finished':epoch(r.get('finishedAt')),'step':step['name'] if step else 'Review closed' if r['status']=='CLOSED' else 'Not supplied',
            'steps':len(w['steps']),'progress':'','files':files})
    previous=Snapshot.objects.filter(key='snapshot').first()
    if not reviews and previous and previous.data.get('current',{}).get('reviews'):raise ValueError('No scoped reviews returned; retain the previous snapshot for verification.')
    return {'revision':(previous.data.get('revision',0) if previous else 0)+1,'updatedAt':now,'previous':None,
        'current':{'schema':1,'name':'Autodesk Forma · M1 Reviews','source':'forma','reportAt':now,'loadedAt':now,'reviews':reviews,'voidCount':0,'warnings':[]}}

def synchronize():
    client=APS();knowledge,midp,tracker=sync_workbooks(client,persist=False);scope=knowledge['scope']['rows']
    from .locations import location_data
    locations=location_data(client,scope)
    files=crawl(client,scope);now=int(time.time()*1000)
    checks={'checkedAt':now,'rows':shared_checks(files,knowledge['mapping']['rows'],knowledge['mapping']['naming'])}
    progress=progress_data(files,tracker,midp,knowledge,now)
    originals=original_data(client,scope,files,now)
    reviews=review_data(client,scope,now)
    with transaction.atomic():
        Snapshot.objects.update_or_create(key='locations',defaults={'data':locations})
        for key,value in [('knowledge',knowledge),('midp',midp),('checker',checks),('models',progress),('originals',originals),('snapshot',reviews),('tracker',tracker)]:Snapshot.objects.update_or_create(key=key,defaults={'data':value})
        # Only unambiguous, observed, in-scope Shared model folders become upload destinations.
        destinations={}
        for f in files:
            if f['source'] in ROOTS and model(f) and not f.get('mappingConflict'):destinations.setdefault(f['folderId'],set()).add((f['scopeId'],f['scopeName'],discipline(f['name']),f['source'],' / '.join(f['folderPath'])))
        current=[]
        for folder,values in destinations.items():
            if len(values)!=1:continue
            asset,name,d,root,path=next(iter(values));current.append(folder)
            UploadDestination.objects.update_or_create(folder_id=folder,defaults={'asset_id':asset,'asset_name':name,'discipline':d,'root':root,'folder_path':path,'verified':True,'active':True})
        UploadDestination.objects.exclude(folder_id__in=current).update(verified=False)
    return {'files':len(files),'checks':len(checks['rows']),'midp':len(midp['entries']),'reviews':len(reviews['current']['reviews'])}
