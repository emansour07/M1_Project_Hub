"""Header-based M1 workbook readers. Missing values never become zero progress."""
import io
import re
from datetime import date, datetime
from collections import defaultdict
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from .aps import APS, SOURCES
from .models import Snapshot

SCOPE_ITEM = 'urn:adsk.wipemea:dm.lineage:sIrhtKWeRjCdGN3fs-vrpg'
TIDP_ITEM = 'urn:adsk.wipemea:dm.lineage:ByB-0ya4S7C6oJlJIkCo9A'
text = lambda v: '' if v is None else str(v).strip()
upper = lambda v: text(v).upper()

def book(data):
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if sum(i.file_size for i in z.infolist())>80_000_000: raise ValueError('Workbook is too large to read safely.')
    return load_workbook(io.BytesIO(data),read_only=True,data_only=True)

def source(tip, item):
    import time
    a = tip.get('attributes',{})
    return {'name':a.get('displayName') or a.get('name'),'versionId':tip['id'],'version':a.get('versionNumber'),
        'updatedAt':a.get('lastModifiedTime'),'checkedAt':int(time.time()*1000),'itemId':item}

def parse_scope(scope_rows, mapping):
    h = next((i for i,r in enumerate(scope_rows) if 'Scope ID' in r and 'Corrected filename' in r),None)
    if h is None: raise ValueError('Scope mapping headers are missing.')
    header = scope_rows[h]
    def cell(row,name): return text(row[header.index(name)]) if name in header else ''
    result = []
    for row in scope_rows[h+1:]:
        ident,code,name,filename = (cell(row,k) for k in ['Scope ID','Scope code','Asset','Corrected filename'])
        if not ident or not code or not name or not filename.upper().startswith('M1-'): continue
        parts = filename.upper().split('-')
        parcel = parts[1]
        section = {'102':'10.2','121':'12.1'}.get(parcel,'')
        local = [m for m in mapping if not section or m['section']==section]
        matches = [m for m in local if m['existing']==code.upper()] if section else []
        if not matches and section: matches = [m for m in local if m['proposed']==code.upper()]
        if not matches: matches = [m for m in local if upper(m['name'])==upper(name)]
        proposed = {m['proposed'] for m in matches}
        proposed = next(iter(proposed)) if len(proposed)==1 else None
        original = cell(row,'Original main-folder workbook').replace('\\','/').split('/')[-1]
        aliases = {code.upper()}
        if original.upper().startswith('M1-'): aliases.add(original.upper().split('-')[3])
        if proposed: aliases.add(proposed)
        aliases -= {'XXX','YYY','ZZZ'}
        ambiguous = [a for a in aliases if any((m['existing']==a or m['proposed']==a) and m not in matches for m in mapping)]
        result.append({'id':ident,'code':code.upper(),'name':name,'zone':cell(row,'Zone'),'party':cell(row,'Party'),
            'parcel':parcel,'section':section,'aliases':sorted(aliases),'ambiguous':ambiguous,'proposed':proposed,'filename':filename})
    if not result or len({r['id'] for r in result})!=len(result): raise ValueError('Invalid scope register.')
    return result

def parse_mapping(rows):
    h = next((i for i,r in enumerate(rows) if any(re.search('proposed',text(v),re.I) for v in r) and any(re.search('section|existing',text(v),re.I) for v in r)),None)
    if h is None: raise ValueError('TIDP Asset Tagging Naming header is missing.')
    old = next(i for i,v in enumerate(rows[h]) if re.search('section|existing',text(v),re.I))
    nxt = next(i for i,v in enumerate(rows[h]) if re.search('proposed',text(v),re.I))
    if nxt!=old+2: raise ValueError('TIDP asset layout changed.')
    section,result = '',[]
    for i,r in enumerate(rows[h+1:],h+2):
        existing,name,proposed = upper(r[old]),text(r[old+1]),upper(r[nxt])
        if not proposed and re.fullmatch(r'\d+(?:\.\d+)*',name): section=name;continue
        if name and re.fullmatch(r'[A-Z0-9]{2,8}',proposed): result.append({'section':section,'existing':existing or None,'proposed':proposed,'name':name,'row':i})
    return result

def scoped(row, scope):
    parts = upper(row.get('name')).split('-')
    path = row.get('folderPath',[])
    parcel = upper(row.get('parcel')) or (parts[1] if len(parts)>1 else '')
    zone = {'102':'Island','121':'Mainland'}.get(parcel)
    if not zone:
        zone = next((z for z in ['Mainland','Island','Subsea'] if re.search(r'\b'+z+r'\b',' '.join(path),re.I)),None)
    candidates = [a for a in scope if not zone or a['zone']==zone]
    asset = parts[3] if len(parts)>=6 and parts[0]=='M1' else None
    def pick(code,context=False):
        return [a for a in candidates if code in a['aliases'] and (zone or context or code not in a['ambiguous'] or a.get('proposed')==code)]
    selected = None
    if asset and asset not in ['XXX','YYY','ZZZ']:
        found = pick(asset)
        if len(found)==1: selected=found[0]
        if not found and not any(asset in a['aliases'] for a in candidates) and asset not in ['ROD','EWK','UTL']: return None
    if not selected:
        tokens = re.split('[^A-Z0-9]+',upper(' '.join(path)))
        found = {a['id']:a for t in tokens for a in pick(t,True)}
        if len(found)==1:
            a = next(iter(found.values()))
            if not asset or asset in ['XXX','YYY','ZZZ'] or asset in a['aliases']: selected=a
    if not selected:
        context = upper(' '.join([row.get('name',''),row.get('description',''),*path]))
        for pattern,category in [(r'EARTHWORK|GRADING|SITE.CLEARANCE|\bEWK\b|\bGB001\b','EW-GRD'),(r'\bROD\b|\bRDI\b|\bBM015\b|ROADS?|FENCING','EW-ROD'),(r'LANDSCAP|SOFTSCAPE|HARDSCAPE|\bBM032\b|\bBM021\b','EW-LAN'),(r'UTILIT|\bUTL\b|\bBM016\b','EW-UTL')]:
            if re.search(pattern,context) and (not asset or asset in ['XXX','YYY','ZZZ','ROD','EWK','UTL']):
                found=[a for a in candidates if a['code']==category]
                if len(found)==1: selected=found[0]
                break
    if not selected: return None
    path_matches={a['id'] for t in re.split('[^A-Z0-9]+',upper(' '.join(path))) for a in pick(t,True)}
    conflict=bool(path_matches and selected['id'] not in path_matches)
    return {**row,'scopeId':selected['id'],'scopeName':selected['name'],
        'mappingConflict':conflict,
        'scopeAsset':selected.get('proposed') if selected.get('proposed') not in [None,'XXX','YYY','ZZZ'] else selected['id']}

def iso(value):
    if isinstance(value,(date,datetime)): return value.strftime('%Y-%m-%d')
    s = text(value)
    for fmt in ['%Y-%m-%d','%d/%m/%Y','%d.%m.%Y']:
        try: return datetime.strptime(s,fmt).strftime('%Y-%m-%d')
        except ValueError: pass
    return None

def named_column(rows,pattern):
    matches = {i for r in rows for i,v in enumerate(r) if re.fullmatch(pattern,' '.join(text(v).split()),re.I)}
    return next(iter(matches)) if len(matches)==1 else None

def midp_entries(data,scope):
    wb = book(data)
    entries=[]
    for sheet in wb:
        if sheet.title=='Index': continue
        if sheet.max_row>10000: raise ValueError('MIDP worksheet exceeds 10,000 rows.')
        rows = list(sheet.values)
        h = next((i for i,r in enumerate(rows) if any(upper(v)=='ISSUE DATE' for v in r)),None)
        if h is None: continue
        top=rows[:h+2]
        planned=named_column(top,r'Planned(?: (?:Submission|Issue|Delivery))?(?: Date)?')
        forecast=named_column(top,r'Forecast(?:ed)?(?: (?:Submission|Issue|Delivery))?(?: Date)?')
        approval=named_column(top,r'MACE_ACC_Status')
        stage=named_column(top,r'Project Stage')
        datecols=[i for i,v in enumerate(rows[h]) if upper(v)=='ISSUE DATE']
        fmt=next((r for r in top if any(text(v).lower()=='.rvt' for v in r)),[])
        discipline,category='','Unclassified'
        for n,r in enumerate(rows[h+1:],h+2):
            name=text(r[0])
            if name.upper().startswith('DISCIPLINE:'): discipline=name.split(':',1)[1].strip();category='Unclassified'
            for pattern,label in [(r'BIM Models?','Models'),(r'DRAWINGS.*','Drawings'),(r'REPORTS?.*','Reports'),(r'SCHEDULES?.*','Schedules'),(r'SPECIFICATIONS?.*','Specifications'),(r'CALCULATIONS?.*','Calculations')]:
                if re.fullmatch(pattern,name,re.I): category=label
            if not name.upper().startswith('M1-'): continue
            exchanges=[{'exchange':i+1,'date':iso(r[c]),'revision':text(r[c-1]),'author':text(r[c+1]),'transmittal':text(r[c+2])} for i,c in enumerate(datecols) if iso(r[c])]
            latest=max(exchanges,key=lambda e:e['date']) if exchanges else {}
            parts=name.split('-')
            item={'id':sheet.title+'!'+str(n),'sheet':sheet.title,'row':n,'name':name,'description':text(r[1]),'discipline':discipline,'category':category,
                'asset':text(r[17]) or parts[3],'originator':text(r[16]) or parts[2],
                'formats':[text(v) for i,v in enumerate(fmt) if text(v).startswith('.') and upper(r[i])=='YES'],
                'plannedDate':iso(r[planned]) if planned is not None else None,'forecastDate':iso(r[forecast]) if forecast is not None else None,
                'plannedColumnFound':planned is not None,'forecastColumnFound':forecast is not None,
                'approvalStatus':text(r[approval]) if approval is not None else '', 'approvalColumnFound':approval is not None,
                'projectStage':text(r[stage]) if stage is not None else '',
                'latestIssueDate':latest.get('date'),'latestExchange':latest.get('exchange'),'revision':latest.get('revision'),'exchanges':exchanges,
                'folderPath':[sheet.title,discipline]}
            code=parts[6].upper() if len(parts)>6 else ''
            item['category']={'BNM':'Models','BGM':'Models','BFM':'Models','MOD':'Models','C3D':'Models','DWG':'Drawings','SDW':'Drawings','RPT':'Reports','REP':'Reports','RPR':'Reports','CAL':'Calculations','SPE':'Specifications','SPC':'Specifications','SCH':'Schedules'}.get(code,category)
            keep=scoped(item,scope)
            if keep: entries.append(keep)
    wb.close()
    return entries

DISCIPLINES={'BM010':'Architecture','BM012':'Structure','GB001':'Earthworks','BM015':'Roads','BM018':'Mechanical','BM019':'Electrical','BM020':'Plumbing','BM024':'Fire fighting','BM023':'ELV','BM025':'BMS','BM032':'Landscape','BM017':'Drainage','BM036':'Mechanical','BM021':'Landscape','BM100':'General','BMXXX':'Civil','BM016':'Utilities / marine'}
def discipline(name):
    p=upper(name).split('-')
    return DISCIPLINES.get(p[5] if len(p)>5 else '', 'Unclassified')

def model_key(row):
    name=re.sub(r'\.(rvt|ifc|nwc|nwd|dwfx|dwg)$','',upper(row['name']))
    # Current tracker reconciliation treats revision as version metadata.
    name=re.sub(r'-R\d+$','',name)
    parts=name.split('-')
    if len(parts)>3:
        parts[1]='FXX'
        if parts[2]=='ARX': parts[2]='SAP'
        parts[3]=row.get('scopeAsset') or parts[3]
    return row.get('scopeId','')+'::'+'-'.join(parts)

LEAD=[{'key':'deliveryStatus','label':'Delivery status','group':'Team update','type':'status'},
      {'key':'responsibleTeam','label':'Responsible team','group':'Team update','type':'text'},
      {'key':'targetDate','label':'Target date','group':'Team update','type':'date'},
      {'key':'blocker','label':'Blocker','group':'Team update','type':'text'},
      {'key':'lastUpdate','label':'Last team update','group':'Team update','type':'date','readonly':True}]

def tracker_data(data,scope,midp,src):
    wb=load_workbook(io.BytesIO(data),data_only=False)
    values=book(data)
    sheet=wb['Tracker'];rows=list(values['Tracker'].values)
    h=next((i for i,r in enumerate(rows) if any(re.fullmatch(r'LOG\s*%',text(v),re.I) for v in r) and any(re.fullmatch(r'LOI\s*%',text(v),re.I) for v in r)),None)
    if h is None: raise ValueError('Tracker LOG / LOI headers missing.')
    columns=[];group=''
    for i,v in enumerate(rows[h]):
        if not text(v): continue
        heading=text(rows[h-1][i]) if h else ''
        if heading: group=heading
        elif not re.match(r'LOD|Team',group,re.I): group=''
        col=get_column_letter(i+1)
        lead=next((c for c in LEAD if c['label']==text(v)),{})
        columns.append({'key':lead.get('key',col),'excelColumn':col,'label':text(v),'index':i,'group':group,
            'hidden':any(d.hidden and (d.min or 0)<=i+1<=(d.max or d.min or 0) for d in sheet.column_dimensions.values()),'type':lead.get('type','date' if re.search('date',text(v),re.I) else 'percent' if re.fullmatch(r'(LOG|LOI)\s*%',text(v),re.I) else 'text'),
            'readonly':lead.get('readonly',False)})
    namecol=next(c for c in columns if c['label'].lower()=='name')
    desc=next((c for c in columns if c['label'].lower()=='description'),None)
    parcel=next((c for c in columns if c['label'].lower()=='parcel'),None)
    result=[]
    expected={model_key(e):e for e in midp if e['category']=='Models' and e['sheet']!='YYY-ARX-BIM'}
    known=set()
    for n,r in enumerate(rows[h+1:],h+2):
        name=text(r[namecol['index']])
        if not name.upper().startswith('M1-'): continue
        fields={c['key']:(iso(r[c['index']]) if isinstance(r[c['index']],(date,datetime)) else r[c['index']]) for c in columns}
        item=scoped({'name':name,'description':text(r[desc['index']]) if desc else '', 'parcel':text(r[parcel['index']]) if parcel else '',
            'row':n,'fields':fields,'formulaFields':[c['key'] for c in columns if sheet.cell(n,c['index']+1).data_type=='f']},scope)
        if not item: continue
        key=model_key(item);known.add(key);match=expected.get(key)
        item.update({'id':'tracker:'+str(n),'key':key,'discipline':discipline(name),'origin':'Excel tracker','missingFromTracker':False,'midp':bool(match),
            'midpName':match['name'] if match else None,'midpNamingCorrection':bool(match and match['name']!=name),'suggestedMidpName':name if match else None,'files':[]})
        result.append(item)
    columns += [c for c in LEAD if not any(x['key']==c['key'] for x in columns)]
    for key,e in expected.items():
        if key in known: continue
        result.append({**e,'id':'midp:'+e['id'],'key':key,'row':None,'missingFromTracker':True,'midp':True,'origin':'MIDP — not in tracker',
            'discipline':discipline(e['name']),'files':[],'fields':{c['key']:e['name'] if c['label']=='Name' else e['description'] if c['label']=='Description' else None for c in columns}})
    wb.close();values.close()
    return {'source':src,'columns':columns,'rows':result,'expectedModels':len(expected),'missingFromTracker':sum(r['missingFromTracker'] for r in result)}

def sync_workbooks(client=None, persist=True):
    client=client or APS()
    data,tip=client.download(TIDP_ITEM);w=book(data)
    mapping=parse_mapping(list(w['Asset Tagging Naming'].values))
    raw=list(w['Supporting Data'].values)
    labels=['Parcel','Originator','Project stage','Package / discipline','Document type','Level']
    rules={'pattern':'Project-Parcel-Originator-Asset-Stage-Package-Type-Level-Number[-Revision]',
        'fields':[{'index':idx,'label':label,'values':[{'code':upper(r[c]),'description':text(r[c-1])} for r in raw[2:] if re.fullmatch('[A-Z0-9]+',text(r[c]))]} for c,idx,label in zip([1,4,7,10,13,16],[1,2,4,5,6,7],labels)]}
    # The approved parcel appendix supersedes the earlier parcel picklist.
    rules['fields'][0]['values']=[{'code':'FXX','description':'Fixed M1 parcel code'}]
    w.close();mapping_source=source(tip,TIDP_ITEM)
    data,tip=client.download(SCOPE_ITEM);w=book(data)
    scope=parse_scope(list(w['Scope mapping'].values),mapping);w.close()
    policy={'rows':scope,'source':source(tip,SCOPE_ITEM)}
    scoped_mapping=[{'section':s['section'] or s['zone'],'existing':s['code'],'proposed':s['proposed'] or s['code'],'name':s['name'],
        'scopeId':s['id'],'mappingPending':not s['proposed'],'ambiguous':s['ambiguous']} for s in scope]
    knowledge={'scope':policy,'mapping':{'source':mapping_source,'rows':scoped_mapping,'naming':rules}}
    data,tip=client.download(SOURCES['midp']);entries=midp_entries(data,scope)
    if not entries: raise ValueError('No scoped MIDP entries were found. Previous data is retained.')
    midp={'source':source(tip,SOURCES['midp']),'entries':entries,'total':len(entries),'dated':sum(bool(e['plannedDate']) for e in entries),'parserVersion':4}
    data,tip=client.download(SOURCES['tracker']);tracker=tracker_data(data,scope,entries,source(tip,SOURCES['tracker']))
    from django.db import transaction
    if persist:
        with transaction.atomic():
            for key,value in [('knowledge',knowledge),('midp',midp),('tracker',tracker)]: Snapshot.objects.update_or_create(key=key,defaults={'data':value})
    return knowledge,midp,tracker
