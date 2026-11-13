import io
import re
import zipfile
import html
from collections import defaultdict
from .workbooks import iso

def attrs(tag): return {k:html.unescape(v) for k,v in re.findall(r'([\w:]+)="([^"]*)"',tag)}

def filter_rows(entries,filters):
    out=[]
    for r in entries:
        if any(filters.get(k) and r.get(f)!=filters[k] for k,f in [('asset','scopeId'),('discipline','discipline'),('originator','originator'),('category','category')]):continue
        if filters.get('format') and filters['format'] not in r.get('formats',[]):continue
        if filters.get('approval'):
            if filters['approval']=='<blank>' and r.get('approvalStatus'):continue
            if filters['approval']!='<blank>' and r.get('approvalStatus')!=filters['approval']:continue
        if filters.get('q') and filters['q'].lower() not in ' '.join(str(r.get(k,'')) for k in ['name','description','scopeName','scopeAsset','discipline']).lower():continue
        out.append(r)
    return out

def export_midp(data,entries,start,end,filters=None):
    if not start or not end or iso(start)!=start or iso(end)!=end or start>end:raise ValueError('Choose a valid planned-date range.')
    selected=[r for r in filter_rows(entries,filters or {}) if r.get('plannedDate') and start<=r['plannedDate']<=end]
    if not selected:raise ValueError('No MIDP entries have a planned date in this range.')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if sum(i.file_size for i in z.infolist())>80_000_000:raise ValueError('Workbook exceeds the export size limit.')
        parts={i.filename:z.read(i) for i in z.infolist()}
    read=lambda p:parts[p].decode('utf8')
    wb,rels=read('xl/workbook.xml'),read('xl/_rels/workbook.xml.rels')
    targets={attrs(t)['Id']:attrs(t)['Target'] for t in re.findall(r'<Relationship\b[^>]*/>',rels)}
    sheets=[attrs(t) for t in re.findall(r'<sheet\b[^>]*/>',wb)]
    strings=re.findall(r'<si\b[^>]*>[\s\S]*?</si>',read('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in parts else []
    selected_rows=defaultdict(set)
    for r in selected:selected_rows[r['sheet']].add(r['row'])
    removed=set();remove_ids=set();used=set()
    for sheet in sheets:
        target=targets[sheet['r:id']];target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
        if '..' in target or target not in parts:raise ValueError('Invalid worksheet relationship.')
        if sheet['name'] not in selected_rows:
            removed.add(target);parts.pop(target);remove_ids.add(sheet['r:id'])
            folder,leaf=target.rsplit('/',1);parts.pop(folder+'/_rels/'+leaf+'.rels',None)
            continue
        wanted=selected_rows[sheet['name']];found=set()
        def row_replace(m):
            row=m.group();n=int(attrs(row.split('>',1)[0]+'>')['r'])
            if n in wanted:
                found.add(n);return re.sub(r'\s+hidden="[^"]*"','',row,count=1)
            cell=re.search(r'<c\b[^>]*\br="A\d+"[^>]*>[\s\S]*?</c>',row)
            if not cell:return row
            c=cell.group();v=re.search(r'<v>([\s\S]*?)</v>',c)
            value=v[1] if v else ''
            if re.search(r'\bt="s"',c):value=re.sub('<[^>]+>','',strings[int(value)]) if value else ''
            elif 'inlineStr' in c:value=''.join(re.findall(r'<t\b[^>]*>([\s\S]*?)</t>',c))
            return f'<row r="{n}" hidden="1"/>' if html.unescape(value).upper().startswith('M1-') else row
        xml=re.sub(r'<row\b[^>]*>[\s\S]*?</row>',row_replace,read(target))
        if found!=wanted:raise ValueError('MIDP rows changed. Refresh and export again.')
        xml=re.sub(r'<hyperlinks\b[^>]*>[\s\S]*?</hyperlinks>|<legacyDrawing\b[^>]*/>','',xml)
        used.update(int(v) for v in re.findall(r'<c\b[^>]*\bt="s"[^>]*>[\s\S]*?<v>(\d+)</v>[\s\S]*?</c>',xml))
        parts[target]=xml.encode()
    wb=re.sub(r'<sheet\b[^>]*/>',lambda m:'' if attrs(m.group())['r:id'] in remove_ids else m.group(),wb)
    wb=re.sub(r'<definedNames\b[^>]*>[\s\S]*?</definedNames>|<externalReferences\b[^>]*>[\s\S]*?</externalReferences>','',wb)
    wb=re.sub(r'activeTab="\d+"','activeTab="0"',wb)
    rels=re.sub(r'<Relationship\b[^>]*/>',lambda m:'' if attrs(m.group()).get('Id') in remove_ids or re.search('externalLink|calcChain',m.group()) else m.group(),rels)
    parts['xl/workbook.xml']=wb.encode();parts['xl/_rels/workbook.xml.rels']=rels.encode()
    if strings:parts['xl/sharedStrings.xml']=('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+''.join(s if i in used else '<si><t></t></si>' for i,s in enumerate(strings))+'</sst>').encode()
    for key in list(parts):
        if re.match(r'xl/(externalLinks|comments|threadedComments|persons)/',key) or re.match(r'xl/comments\d+\.xml$',key) or key=='xl/calcChain.xml':removed.add(key);del parts[key]
    for key in list(parts):
        if key.endswith('.rels'):parts[key]=re.sub(r'<Relationship\b[^>]*/>',lambda m:'' if re.search('comments|threadedComment|person|externalLink',m.group()) else m.group(),read(key)).encode()
    parts['[Content_Types].xml']=re.sub(r'<Override\b[^>]*/>',lambda m:'' if attrs(m.group()).get('PartName','').lstrip('/') in removed else m.group(),read('[Content_Types].xml')).encode()
    if 'docProps/app.xml' in parts:parts['docProps/app.xml']=b'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>'
    result=io.BytesIO()
    with zipfile.ZipFile(result,'w',zipfile.ZIP_DEFLATED) as z:
        for key,value in parts.items():z.writestr(key,value)
    return result.getvalue()
