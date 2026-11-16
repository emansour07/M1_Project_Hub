"""Read current scoped TIDPs; publish a complete merged MIDP without changing ACC files."""
import base64
import hashlib
import io
import json
import re
import time
import uuid
import zipfile
from copy import copy, deepcopy
from collections import defaultdict
from xml.etree import ElementTree as ET
from openpyxl import Workbook, load_workbook
from openpyxl.utils import column_index_from_string
from django.db import transaction
from .models import Snapshot
from .workbooks import scoped, midp_entries, source, iso
from .exports import filter_rows

FOLDER='urn:adsk.wipemea:fs.folder:co.3hNWncQDQZqVV9YPTm7Pyg'
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ET.register_namespace('',NS)
ET.register_namespace('r','http://schemas.openxmlformats.org/officeDocument/2006/relationships')

def acc_link(item=''):
    from .aps import quote
    from django.conf import settings
    return 'https://acc.autodesk.eu/docs/files/projects/'+settings.M1_PROJECT_ID+'?folderUrn='+quote(FOLDER)+('&entityId='+quote(item) if item else '')

def source_scope(name,scope):
    exact=[s for s in scope if s['filename'].upper()==name.upper()]
    if len(exact)==1:return exact[0]
    match=scoped({'name':name,'folderPath':[name.replace('_',' ')]},scope)
    return next((s for s in scope if match and s['id']==match['scopeId']),None)

def current_sources(client,scope):
    result=[]
    for item in client.contents(FOLDER):
        name=item.get('attributes',{}).get('displayName') or item.get('attributes',{}).get('name','')
        if item['type']=='items' and re.search(r'_TIDP_.+\.xlsx$',name,re.I):
            result.append({'id':item['id'],'name':name,'versionId':item.get('relationships',{}).get('tip',{}).get('data',{}).get('id')})
    if not result or len(result)>100:raise ValueError('The current TIDP folder must contain 1–100 scoped workbooks.')
    return sorted(result,key=lambda x:x['name'])

def compact_workbook(data):
    """Remove blank formatted columns while streaming oversized worksheet XML."""
    result=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source_zip,zipfile.ZipFile(result,'w',zipfile.ZIP_DEFLATED) as target:
        if sum(i.file_size for i in source_zip.infolist())>256_000_000:raise ValueError('TIDP exceeds the reader size limit.')
        for info in source_zip.infolist():
            if not re.fullmatch(r'\[Content_Types\].xml|_rels/.rels|xl/(workbook.xml|_rels/workbook.xml.rels|styles.xml|sharedStrings.xml|theme/theme1.xml|worksheets/sheet\d+.xml)',info.filename):continue
            if '/worksheets/' not in info.filename:
                value=source_zip.read(info)
                if info.filename=='xl/workbook.xml':value=re.sub(rb'<externalReferences\b[^>]*>[\s\S]*?</externalReferences>',b'',value)
                target.writestr(info.filename,value);continue
            with source_zip.open(info) as stream:
                stack=[];root=None
                for event,node in ET.iterparse(stream,events=['start','end']):
                    tag=node.tag.rsplit('}',1)[-1]
                    if event=='start':
                        if root is None:root=node
                        stack.append(node);continue
                    parent=stack[-2] if len(stack)>1 else None
                    remove=False
                    if tag=='c':
                        letters=re.sub(r'\d','',node.get('r','A1'));c=column_index_from_string(letters)
                        remove=c>256 or c>64 and not len(node)
                    elif tag=='dimension':remove=True
                    elif tag=='col':
                        remove=int(node.get('min','1'))>256
                        if int(node.get('max','1'))>256:node.set('max','256')
                    elif tag in ['drawing','legacyDrawing','legacyDrawingHF','hyperlinks','extLst','tableParts','oleObjects','controls','dataValidations']:remove=True
                    if remove and parent is not None:parent.remove(node)
                    stack.pop()
                target.writestr(info.filename,ET.tostring(root,encoding='utf-8',xml_declaration=True))
    return result.getvalue()

def copy_delivery_sheet(original,target,wanted):
    last=max(wanted)
    for row in original.iter_rows(max_row=last,max_col=min(original.max_column,256)):
        n=row[0].row
        if str(row[0].value or '').upper().startswith('M1-') and n not in wanted:
            target.row_dimensions[n].hidden=True;continue
        for c in row:
            if c.value is None and not c.has_style:continue
            if c.column>64 and c.value is None:continue
            d=target.cell(c.row,c.column,c.value)
            if c.has_style:
                d.font=copy(c.font);d.fill=copy(c.fill);d.border=copy(c.border);d.alignment=copy(c.alignment);d.number_format=c.number_format;d.protection=copy(c.protection)
    for n,d in original.row_dimensions.items():
        if n<=last:
            target.row_dimensions[n]=copy(d)
            if n in wanted:target.row_dimensions[n].hidden=False
            elif str(original.cell(n,1).value or '').upper().startswith('M1-'):target.row_dimensions[n].hidden=True
    for n,d in original.column_dimensions.items():target.column_dimensions[n]=copy(d)
    for r in original.merged_cells.ranges:
        if r.min_row<=last and r.max_col<=256:target.merge_cells(str(r))
    target.freeze_panes=original.freeze_panes
    target.sheet_format=copy(original.sheet_format)
    target.page_margins=copy(original.page_margins);target.page_setup=copy(original.page_setup);target.print_options=copy(original.print_options)

def introduction_scope(data,src,scope):
    context=source_scope(src['name'],scope)
    if context:return context
    w=load_workbook(io.BytesIO(data),read_only=True,data_only=True,keep_links=False)
    description=''
    if 'Introduction' in w:
        for row in w['Introduction'].iter_rows(max_row=40,max_col=5,values_only=True):
            for i,v in enumerate(row):
                if re.fullmatch(r'Asset\s*/\s*Building',str(v or ''),re.I):description=' '.join(str(v or '') for v in row[i+1:])
    w.close()
    old=re.search(r'Formerly\s+([^)]*)',description,re.I)
    if not old:return None
    code=src['name'].upper().split('-')[3]
    if code in ['XXX','YYY','BIM','GEN']:return None
    zone=next((z for z in ['Subsea','Mainland','Island'] if re.search(r'\b'+z+r'\b',description,re.I)),None)
    tokens=re.split(r'[^A-Z0-9]+',old[1].upper())
    matches=[r for r in scope if (not zone or r['zone']==zone) and any(t in r['aliases'] or t==r['code'] for t in tokens)]
    if len(matches)!=1:return None
    return {**matches[0],'proposed':code,'aliases':list(set(matches[0]['aliases']+[code])),'mappingEvidence':description}

def extract_source(data,src,scope):
    context=introduction_scope(data,src,scope)
    if not context:return {'source':src,'scopeId':None,'entries':[],'workbook':''}
    scope=[context if s['id']==context['id'] else s for s in scope]
    compact=compact_workbook(data)
    entries=midp_entries(compact,scope,[context['zone'],context['code'],src['name'].replace('_',' ')])
    if not entries:raise ValueError('No scoped deliverables in '+src['name'])
    for row in entries:
        row.update(id=src['itemId']+'!'+row['id'],sourceId=src['itemId'],sourceName=src['name'],sourceVersion=src['version'],sourceUrl=acc_link(src['itemId']))
        row['discipline']=row['discipline'] or row['sheet']
    # Cache only in-scope delivery sheets; supporting and received-file sheets stay in ACC.
    original=load_workbook(io.BytesIO(compact),data_only=True,keep_links=False);output=Workbook();output.remove(output.active)
    for sheet in original:
        wanted={r['row'] for r in entries if r['sheet']==sheet.title}
        if wanted:copy_delivery_sheet(sheet,output.create_sheet(sheet.title),wanted)
    data=io.BytesIO();output.save(data);original.close();output.close()
    return {'source':src,'scopeId':context['id'],'entries':entries,'workbook':base64.b64encode(data.getvalue()).decode()}

def merge_sources(records):
    groups=defaultdict(list)
    for record in records:
        for row in record['entries']:groups[row['scopeId']+'|'+row['name'].upper()].append(row)
    entries=[]
    for key,variants in groups.items():
        origins=[{k:v.get(k) for k in ['id','sourceId','sourceName','sourceVersion','sourceUrl','sheet','row']} for v in variants]
        fields=['description','category','discipline','originator','plannedDate','forecastDate','approvalStatus','projectStage','latestIssueDate','revision','formats','exchanges']
        conflicts=[f for f in fields if len({json.dumps(v.get(f),sort_keys=True) for v in variants})>1]
        for variant in variants:
            row=deepcopy(variant)
            row.update(rowDeliverable=True,origins=origins,duplicateKey=key,conflictFields=conflicts,conflict=bool(conflicts),duplicateCount=len(variants)-1)
            entries.append(row)
    return entries

def sync_tidps(client,scope,persist=True):
    sources=current_sources(client,scope);records=[];generation=str(uuid.uuid4())
    fingerprint=hashlib.sha256(json.dumps(scope,sort_keys=True).encode()).hexdigest()
    previous=Snapshot.objects.filter(key='midp').first() if persist else None
    previous=previous.data if previous else {}
    cached={}
    if previous.get('scopeFingerprint')==fingerprint and previous.get('parserVersion') in (2,3):
        for record in Snapshot.objects.filter(key__startswith='tidp:'+previous['generation']+':'):
            cached[record.data['source']['itemId']]=record.data
    for item in sources:
        old=cached.get(item['id'])
        if old and item['versionId'] and old['source']['versionId']==item['versionId']:records.append(old);continue
        data,tip=client.download(item['id']);records.append(extract_source(data,source(tip,item['id']),scope))
    check={i['id']:i['versionId'] for i in current_sources(client,scope)}
    if len(check)!=len(records) or any(r['source']['itemId'] not in check or check[r['source']['itemId']] and check[r['source']['itemId']]!=r['source']['versionId'] for r in records):raise ValueError('TIDPs changed during refresh; the previous MIDP is retained.')
    entries=merge_sources(records);checked=int(time.time()*1000)
    found={r['scopeId'] for r in records if r['scopeId']}
    result={'source':{'kind':'tidp-merge','name':'MIDP from current TIDPs','version':generation,'checkedAt':checked,'sources':[r['source'] for r in records if r['entries']]},'generation':generation,'scopeFingerprint':fingerprint,'entries':entries,'total':len(entries),'dated':sum(bool(r['plannedDate']) for r in entries),'duplicates':len(entries)-len({r['duplicateKey'] for r in entries}),'duplicateGroups':len({r['duplicateKey'] for r in entries if r['duplicateCount']}),'affectedDocuments':sum(bool(r['duplicateCount']) for r in entries),'conflicts':len({r['duplicateKey'] for r in entries if r['conflict']}),'countBasis':'tidp-row','missingSources':[{'id':s['id'],'name':s['name'],'code':s['code']} for s in scope if s['id'] not in found],'parserVersion':3}
    if persist:
        with transaction.atomic():
            for i,record in enumerate(records):Snapshot.objects.update_or_create(key='tidp:'+generation+':'+str(i),defaults={'data':record})
            result['recordCount']=len(records)
            Snapshot.objects.update_or_create(key='midp',defaults={'data':result})
            Snapshot.objects.filter(key__startswith='tidp:').exclude(key__startswith='tidp:'+generation+':').delete()
    return result

def export_merged(snapshot,filters):
    start,end=filters.get('start'),filters.get('end')
    if (start or end) and (not start or not end or iso(start)!=start or iso(end)!=end or start>end):raise ValueError('Choose a valid planned-date range.')
    selected=[r for r in filter_rows(snapshot['entries'],filters) if not(start or end) or r.get('plannedDate') and start<=r['plannedDate']<=end]
    if not selected:raise ValueError('No deliverables match this export.')
    wanted=defaultdict(set)
    for r in selected:
        for o in ([r] if r.get('rowDeliverable') else r['origins'] if r['conflict'] else r['origins'][:1]):wanted[(o['sourceId'],o['sheet'])].add(o['row'])
    output=Workbook();output.remove(output.active);audit=[]
    for i in range(snapshot['recordCount']):
        record=Snapshot.objects.get(key='tidp:'+snapshot['generation']+':'+str(i)).data;src=record['source']
        if not any(k[0]==src['itemId'] for k in wanted):continue
        original=load_workbook(io.BytesIO(base64.b64decode(record['workbook'])),data_only=True,keep_links=False)
        for sheet in original:
            keep=wanted.get((src['itemId'],sheet.title))
            if not keep:continue
            asset=next(r['scopeAsset'] for r in record['entries'] if r['sheet']==sheet.title)
            title=re.sub(r'[\\/*?:\[\]]','',f'{len(output.worksheets)+1} {asset} {sheet.title}')[:31]
            copy_delivery_sheet(sheet,output.create_sheet(title),keep)
        original.close();audit.append([src['name'],src['version'],src.get('updatedAt'),acc_link(src['itemId'])])
    sheet=output.create_sheet('TIDP sources');sheet.append(['Source TIDP','ACC version','Last modified','ACC link'])
    for r in audit:sheet.append(r)
    data=io.BytesIO();output.save(data);output.close();return data.getvalue()
