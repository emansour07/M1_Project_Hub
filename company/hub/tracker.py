import io
import re
import html
import zipfile
from datetime import date
from django import forms
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, column_index_from_string
from .auth import allowed
from .aps import APS,SOURCES
from .models import Snapshot, TrackerDraft, SyncJob
from .workbooks import LEAD
from .exports import attrs
from .services import audit

TRACKER_FOLDER='urn:adsk.wipemea:fs.folder:co.kzFcCskdT0STsx3N2xYM8A'
PROTECTED={'#','name','parcel','description'}

def editable(user,row,column):
    return allowed(user,row['scopeId'],row['discipline']) and not column.get('readonly') and column['label'].strip().lower() not in PROTECTED and column['key'] not in row.get('formulaFields',[]) and (user['owner'] or '*' in user['fields'] or column['key'] in user['fields'])

class DraftForm(forms.Form):
    def __init__(self,user,row,columns,*args,**kwargs):
        super().__init__(*args,**kwargs)
        for c in columns:
            if not editable(user,row,c):continue
            initial=row.get('fields',{}).get(c['key']);label=(c.get('group','')+' · '+c['label']).strip(' ·')
            if c['type']=='percent':
                if isinstance(initial,(int,float)) and 0<=initial<=1:initial*=100
                field=forms.FloatField(required=False,min_value=0,max_value=100,label=label,initial=initial)
            elif c['type']=='date':field=forms.DateField(required=False,label=label,initial=initial,widget=forms.DateInput(attrs={'type':'date'}))
            elif c['type']=='status':field=forms.ChoiceField(required=False,label=label,initial=initial,choices=[('','Not reported')]+[(s,s) for s in ['Not started','Active','On hold','Complete']])
            else:field=forms.CharField(required=False,label=label,initial=initial,max_length=2000,widget=forms.Textarea(attrs={'rows':2}) if c['key']=='blocker' else forms.TextInput())
            self.fields[c['key']]=field
    def changes(self,row,columns):
        output={}
        for key,value in self.cleaned_data.items():
            c=next(c for c in columns if c['key']==key)
            if isinstance(value,date):value=value.isoformat()
            if c['type']=='percent' and value is not None:value=value/100
            before=row.get('fields',{}).get(key)
            if (value if value is not None else '')!=(before if before is not None else ''):output[key]=value
        return output

def patch_workbook(data,draft,row,columns):
    # Modify only required XML cells; preserve styles, drawings and all other workbook parts.
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if sum(i.file_size for i in z.infolist())>80_000_000:raise ValueError('Tracker exceeds the publication size limit.')
        parts={i.filename:z.read(i) for i in z.infolist()}
    w=load_workbook(io.BytesIO(data),data_only=False);sheet=w['Tracker']
    h=next((r[0].row for r in sheet if any(str(c.value).strip()=='Name' for c in r) and any(re.fullmatch(r'LOG\s*%',str(c.value),re.I) for c in r)),None)
    if not h:raise ValueError('Tracker layout changed.')
    name_col=next(c.column for c in sheet[h] if c.value=='Name')
    matches=[r for r in range(h+1,sheet.max_row+1) if str(sheet.cell(r,name_col).value or '').strip()==draft.model_name]
    if row['missingFromTracker'] and matches or not row['missingFromTracker'] and len(matches)!=1:raise ValueError('Tracker row changed. Submit a fresh draft.')
    target=sheet.max_row+1 if row['missingFromTracker'] else matches[0]
    if sheet.protection.sheet:raise ValueError('The tracker is protected; publishing is stopped.')
    workbook=parts['xl/workbook.xml'].decode();relationships=parts['xl/_rels/workbook.xml.rels'].decode()
    entry=next(attrs(t) for t in re.findall(r'<sheet\b[^>]*/>',workbook) if attrs(t).get('name')=='Tracker')
    rel=next(attrs(t) for t in re.findall(r'<Relationship\b[^>]*/>',relationships) if attrs(t).get('Id')==entry['r:id'])
    path=rel['Target'].lstrip('/') if rel['Target'].startswith('/') else 'xl/'+rel['Target']
    if '..' in path:raise ValueError('Invalid tracker sheet path.')
    xml=parts[path].decode();updates={};colmap={c['key']:dict(c) for c in columns};nextcol=sheet.max_column+1
    def put(n,c,v):updates.setdefault(n,{})[c]=v
    for c in colmap.values():
        if 'excelColumn' not in c:
            c['excelColumn']=get_column_letter(nextcol);nextcol+=1
            put(h,c['excelColumn'],c['label'])
            if h>1:put(h-1,c['excelColumn'],'Team update')
    if row['missingFromTracker']:
        for c in colmap.values():
            if c['label']=='Name':put(target,c['excelColumn'],draft.model_name)
            elif c['label']=='Description':put(target,c['excelColumn'],row.get('description',''))
            elif c['label']=='Parcel':put(target,c['excelColumn'],draft.model_name.split('-')[1])
    changes={**draft.changes,'lastUpdate':timezone.localdate().isoformat()}
    for key,value in changes.items():
        if key not in colmap:raise ValueError('An edited field no longer exists.')
        c=colmap[key];column=column_index_from_string(c['excelColumn'])
        if sheet.cell(target,column).data_type=='f':raise ValueError('Formula cells cannot be overwritten.')
        if c['label'].strip().lower() in PROTECTED:raise ValueError('Model identity cannot be overwritten.')
        put(target,c['excelColumn'],value)
    def cell(ref,value,style=None):
        a=' r="'+ref+'"'+(' s="'+style+'"' if style else '')
        if value is None or value=='':return '<c'+a+'/>'
        if isinstance(value,(int,float)):return '<c'+a+'><v>'+str(value)+'</v></c>'
        return '<c'+a+' t="inlineStr"><is><t xml:space="preserve">'+html.escape(str(value))+'</t></is></c>'
    def patch(old,n,items):
        cells={attrs(t.split('>',1)[0]+'>')['r']:t for t in re.findall(r'<c\b[^>]*?(?:/>|>[\s\S]*?</c>)',old)}
        for col,value in items.items():
            ref=col+str(n);prior=cells.get(ref,'');style=attrs(prior.split('>',1)[0]+'>').get('s')
            cells[ref]=cell(ref,value,style)
        opening=old.split('>',1)[0]+'>' if old else f'<row r="{n}">'
        opening=re.sub(r'\s+spans="[^"]*"','',opening)
        return opening+''.join(cells[k] for k in sorted(cells,key=lambda r:column_index_from_string(re.sub(r'\d+','',r))))+'</row>'
    for n,items in updates.items():
        pattern=rf'<row\b[^>]*\br="{n}"[^>]*>[\s\S]*?</row>'
        if re.search(pattern,xml):xml=re.sub(pattern,lambda m:patch(m.group(),n,items),xml,count=1)
        else:xml=xml.replace('</sheetData>',patch('',n,items)+'</sheetData>')
    xml=re.sub(r'<dimension\b[^>]*/>',f'<dimension ref="A1:{get_column_letter(max(sheet.max_column,nextcol-1))}{max(sheet.max_row,target)}"/>',xml)
    parts[path]=xml.encode();w.close();out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for key,value in parts.items():z.writestr(key,value)
    return out.getvalue()

def prepare(draft):
    data=Snapshot.objects.get(key='tracker').data
    row=next((r for r in data['rows'] if r['id']==draft.row_id and r['scopeId']==draft.scope_id and r['name']==draft.model_name),None)
    if not row:raise ValueError('This model is no longer in the current scoped tracker.')
    client=APS();raw,tip=client.download(SOURCES['tracker'])
    if tip['id']!=draft.source_version:raise ValueError('Excel changed since this draft. Refresh and submit a new draft.')
    return patch_workbook(raw,draft,row,data['columns']),tip

def publish(draft_id,owner_email):
    if not settings.M1_TRACKER_WRITE_ENABLED:raise ValueError('Tracker publication is awaiting company Autodesk write-access configuration.')
    SyncJob.objects.get_or_create(key='tracker-publish',defaults={'state':'idle'})
    if not SyncJob.objects.filter(key='tracker-publish',state='idle').update(state='running',started_at=timezone.now()):raise ValueError('Another tracker publication is running.')
    draft=None;committing=False
    try:
        if not TrackerDraft.objects.filter(pk=draft_id,status='pending').update(status='publishing'):raise ValueError('This draft is no longer pending.')
        draft=TrackerDraft.objects.get(pk=draft_id)
        payload,tip=prepare(draft);name=tip['attributes'].get('displayName') or tip['attributes']['name']
        client=APS(('data:read','data:write','data:create'))
        storage=client.upload_storage(TRACKER_FOLDER,name,SimpleUploadedFile(name,payload))
        if client.tip(SOURCES['tracker'])['id']!=tip['id']:raise ValueError('Excel changed during publication. Refresh and submit a new draft.')
        committing=True
        result=client.commit_file(TRACKER_FOLDER,name,storage,SOURCES['tracker'])
        draft.status='published';draft.approved_by=owner_email;draft.published_version=result['data']['id'];draft.save()
        audit(owner_email,'tracker.published',draft.id,version=draft.published_version)
        from .jobs import queue_sync
        queue_sync()
    except Exception:
        if draft:
            draft.status='verification_required' if committing else 'pending';draft.save(update_fields=['status'])
        raise
    finally:SyncJob.objects.filter(key='tracker-publish').update(state='idle')
