"""Consolidated MIDP export, sharing its sanitized layout with the interim Worker."""
import base64
import io
import json
import re
import zipfile
from collections import OrderedDict
from datetime import date, datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET
from openpyxl import load_workbook
from openpyxl.utils.datetime import to_excel
from xml.sax.saxutils import escape

LAYOUT=json.loads(Path(__file__).with_name('midp-layout.json').read_text(encoding='utf8'))
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
DATES={27,31,35,39,43,47,51,55,56}
def esc(value):return escape(re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(value if value is not None else '')),{'"':'&quot;'})
def norm(v):return re.sub(r'\s+',' ',str(v if v is not None else '').strip()).lower()
def letter(i):
    s='';i+=1
    while i:s=chr(65+(i-1)%26)+s;i=(i-1)//26
    return s
def layout_values(raw):
    result={}
    for c in ET.fromstring(raw):
        letters=re.sub(r'\d','',c.get('r'));i=0
        for ch in letters:i=i*26+ord(ch)-64
        result[i-1]=''.join(c.itertext())
    return result
HEADERS=layout_values(LAYOUT['headerRows'][5]);FORMATS=layout_values(LAYOUT['headerRows'][6])
def serial(value):
    if isinstance(value,(date,datetime)):return to_excel(value)
    if isinstance(value,str):
        try:return to_excel(date.fromisoformat(value[:10]))
        except ValueError:pass
        for fmt in ['%d/%m/%Y','%d.%m.%Y']:
            try:return to_excel(datetime.strptime(value,fmt))
            except ValueError:pass
    return value
def consolidated_data(records,entries):
    selected={(e['sourceId'],e['sheet'],e['row']):e for e in entries};groups={};sources=[]
    for record in records:
        src=record['source'];used=False
        book=load_workbook(io.BytesIO(base64.b64decode(record['workbook'])),data_only=True,read_only=True,keep_links=False)
        for sheet in book:
            rows=list(sheet.iter_rows(values_only=True))
            header=next((r for r in rows if any(norm(v)=='issue date' for v in r)),[])
            formats=next((r for r in rows if any(norm(v).lstrip('.')=='rvt' for v in r)),[])
            issues=[i for i,v in enumerate(header) if norm(v)=='issue date']
            owner_row=next((r for r in rows if any(norm(v)=='owner:' for v in r)),[])
            owners=[owner_row[c] if c<len(owner_row) and owner_row[c] is not None else '' for c in issues]
            for rownum,raw in enumerate(rows,1):
                e=selected.get((src['itemId'],sheet.title,rownum))
                if not e:continue
                used=True;suffix=re.split('_TIDP_',src['name'],flags=re.I)[-1];suffix=re.sub(r'\.xlsx?m?$','',suffix,flags=re.I).lower()
                tab=LAYOUT['assetTabs'].get(suffix) or e.get('scopeId') or e['scopeAsset'];tab=re.sub(r'[\\/*?:\[\]]','',tab)[:31]
                values=['']*57;values[0]=e['name'];values[1]=e.get('description','')
                for i in range(2,13):
                    j=next((j for j,v in enumerate(formats) if norm(v).lstrip('.')==norm(FORMATS.get(i)).lstrip('.')),None)
                    if j is not None:values[i]=raw[j] if j<len(raw) and raw[j] is not None else ''
                for i in range(13,26):
                    j=next((j for j,v in enumerate(header) if norm(v)==norm(HEADERS.get(i))),None)
                    if j is not None:values[i]=raw[j] if j<len(raw) and raw[j] is not None else ''
                for i,column in enumerate(issues[:7]):
                    for j in range(4):
                        c=column-1+j;values[26+i*4+j]=raw[c] if 0<=c<len(raw) and raw[c] is not None else ''
                values[54]=e.get('approvalStatus') or '';values[55]=e.get('plannedDate') or '';values[56]=e.get('forecastDate') or ''
                for i in DATES:values[i]=serial(values[i])
                groups.setdefault(tab,[]).append({'entry':e,'values':values,'tab':tab,'owners':owners})
        book.close()
        if used:sources.append(src)
    assets=[{'tab':tab,'rows':groups[tab]} for tab in sorted(groups)]
    if sum(len(a['rows']) for a in assets)!=len(entries):raise ValueError('TIDP export source is incomplete. Refresh and retry.')
    return assets,sources
def cell(v,c,r,style=None):
    style=LAYOUT['bodyStyle'] if style is None else style
    body=f'><v>{v}</v>' if isinstance(v,(int,float)) else f' t="inlineStr"><is><t xml:space="preserve">{esc(v)}</t></is>'
    return f'<c r="{letter(c)}{r}" s="{style}"'+body+'</c>'
def row(values,r,style=None,dates=False):
    return f'<row r="{r}" ht="30" customHeight="1">'+''.join(cell(v,c,r,LAYOUT['dateStyle'] if dates and c in DATES and isinstance(v,(int,float)) else style) for c,v in enumerate(values))+'</row>'
def worksheet(rows,cols='',merges=(),freeze=0,filter_ref='',links=()):
    pane=f'<pane ySplit="{freeze}" topLeftCell="A{freeze+1}" activePane="bottomLeft" state="frozen"/>' if freeze else ''
    merge_xml='<mergeCells count="'+str(len(merges))+'">'+''.join(f'<mergeCell ref="{m}"/>' for m in merges)+'</mergeCells>' if merges else ''
    link_xml='<hyperlinks>'+''.join(f'<hyperlink ref="{ref}" location="{esc(location)}" display="{esc(label)}"/>' for ref,location,label in links)+'</hyperlinks>' if links else ''
    auto=f'<autoFilter ref="{filter_ref}"/>' if filter_ref else ''
    return f'<worksheet xmlns="{NS}"><sheetViews><sheetView showGridLines="0" workbookViewId="0">{pane}</sheetView></sheetViews>{cols}<sheetData>{rows}</sheetData>{auto}{merge_xml}{link_xml}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="8" fitToWidth="1" fitToHeight="0"/></worksheet>'
def columns(n,width=24):return f'<cols><col min="1" max="{n}" width="{width}" customWidth="1"/></cols>'
def location(tab):return "'"+tab.replace("'","''")+"'!A1"
def asset_sheet(asset):
    rows=''.join(LAYOUT['headerRows']).replace('{{ASSET}}',esc(asset['tab']))
    for i in range(7):
        c=27+i*4;ref=letter(c)+'4';owners=', '.join(dict.fromkeys(str(r['owners'][i]) for r in asset['rows'] if len(r['owners'])>i and r['owners'][i]))
        rows=re.sub(r'<c\b[^>]*\br="'+ref+r'"[^>]*?(?:/>|>[\s\S]*?</c>)',lambda m:cell(owners,c,4,32),rows)
    rows=re.sub(r'(<row\b[^>]*\br="6"[^>]*>)([\s\S]*?)(</row>)',lambda m:m[1]+m[2]+''.join(cell(v,54+i,6,32) for i,v in enumerate(['MACE_ACC_Status','Planned Date','Forecast Date']))+m[3],rows)
    merges=LAYOUT['merges']+['BC6:BC7','BD6:BD7','BE6:BE7'];n=8;disciplines=OrderedDict()
    for item in asset['rows']:
        e=item['entry'];disciplines.setdefault(e.get('discipline') or e['sheet'],[]).append(item)
    for disc,items in disciplines.items():
        rows+=row(['DISCIPLINE: '+disc],n,32);merges.append(f'A{n}:BE{n}');n+=1;category=None
        for item in items:
            if item['entry'].get('category')!=category:
                category=item['entry'].get('category');rows+=row([category or 'Deliverables'],n,34);merges.append(f'A{n}:BE{n}');n+=1
            rows+=row(item['values'],n,dates=True);n+=1
    cols=LAYOUT['columns'].replace('</cols>','<col min="55" max="57" width="20" customWidth="1"/></cols>')
    return worksheet(rows,cols,merges,7).replace('ySplit="7" topLeftCell="A8" activePane="bottomLeft"','xSplit="2" ySplit="7" topLeftCell="C8" activePane="bottomRight"')
def summary_sheet(assets):
    rows=[];merges=['A1:S1','A2:S2'];links=[];n=1
    def add(values,style=None):
        nonlocal n
        rows.append(row(values,n,style));n+=1
    add(['MIDP Summary - drawings per asset and discipline'],32)
    add(['Counts drawing deliverable rows (DWG document type) in this export. Every TIDP row is retained, including repeated numbers.']);n+=1
    bytab={a['tab']:a for a in assets};known={a for g in LAYOUT['summaryGroups'] for a in g['assets']}
    groups=LAYOUT['summaryGroups']+[{'title':'OTHER SCOPED ASSETS','assets':[a['tab'] for a in assets if a['tab'] not in known],'disciplines':sorted({r['entry'].get('discipline') or r['entry']['sheet'] for a in assets for r in a['rows']})}];grand=0
    for group in groups:
        names=[a for a in group['assets'] if a in bytab]
        if not names:continue
        discs=group['disciplines'];add([group['title']+f' ({len(names)})'],32);merges.append(f'A{n-1}:{letter(len(discs)+2)}{n-1}');add(['Asset',*discs,'Other','Total'],34);totals=[0]*(len(discs)+1)
        for name in names:
            items=[r for r in bytab[name]['rows'] if str(r['values'][20] or r['entry']['name'].split('-')[6]).upper()=='DWG'];counts=[0]*len(totals)
            for item in items:
                disc=item['entry'].get('discipline') or item['entry']['sheet'];counts[discs.index(disc) if disc in discs else -1]+=1
            totals=[a+b for a,b in zip(totals,counts)];links.append((f'A{n}',location(name),name));add([name,*counts,len(items)])
        grand+=sum(totals);add(['Total',*totals,sum(totals)],34);n+=2
    add(['Grand total (all drawing schedules)',grand],32);add(['All exported deliverables',sum(len(a['rows']) for a in assets)])
    return worksheet(''.join(rows),'<cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="30" width="11" customWidth="1"/></cols>',merges,links=links)
def export_consolidated(records,entries):
    assets,sources=consolidated_data(records,entries);sheets=[('Summary',summary_sheet(assets),False)]
    index=row(['MIDP MASTER REGISTER - CONSOLIDATED MIDP REGISTER'],1,32)+row(['Master Information Delivery Plans (MIDP) Consolidated by Asset and Discipline'],2)+row([f'Total Assets: {len(assets)} | Total Deliverables: {len(entries)}'],3)+row(['No.','Asset Worksheet Tab','Disciplines Count','Disciplines Included','Total Deliverables','Original Source File Name','Status','Source Modified'],5,34);links=[]
    for i,a in enumerate(assets):
        discs=list(dict.fromkeys(r['entry'].get('discipline') or r['entry']['sheet'] for r in a['rows']));src=[s for s in sources if any(r['entry']['sourceId']==s['itemId'] for r in a['rows'])]
        index+=row([i+1,a['tab'],len(discs),', '.join(discs),len(a['rows']),'\n'.join(s['name'] for s in src),'Repeated numbers' if any(r['entry'].get('duplicateCount') for r in a['rows']) else 'OK','\n'.join(s.get('updatedAt') or '' for s in src)],i+6);links.append((f'B{i+6}',location(a['tab']),a['tab']))
    sheets.append(('Index',worksheet(index,columns(8,30),['A1:H1','A2:H2','A3:H3'],5,links=links),True))
    data=row([*[f'c{i+1:02d}' for i in range(57)],'Disc','Asset'],1,34);n=2
    for a in assets:
        for r in a['rows']:data+=row([*r['values'],r['entry'].get('discipline') or r['entry']['sheet'],a['tab']],n,dates=True);n+=1
    sheets.append(('Data',worksheet(data,freeze=1,filter_ref=f'A1:BG{n-1}'),True))
    settings=[['Source','Current scoped ACC TIDPs'],['Layout',LAYOUT['reference']],['Exported at',datetime.now(timezone.utc).isoformat()],['Export refresh','Use Refresh in the M1 dashboard, then export again.'],['Counting','One source TIDP row is one deliverable.'],['Source file','Asset tab']]
    for a in assets:settings.extend([s['name'],a['tab']] for s in sources if any(r['entry']['sourceId']==s['itemId'] for r in a['rows']))
    sheets.append(('Settings',worksheet(''.join(row(v,i+1,34 if i==5 else None) for i,v in enumerate(settings)),columns(2,70)),False))
    sheets.extend((a['tab'],asset_sheet(a),False) for a in assets)
    byid={s['itemId']:s for s in sources};audit=[['Source TIDP','ACC version','Last modified','ACC link','Source sheet','Source row','Asset tab','Deliverable']]
    for a in assets:
        for r in a['rows']:
            e=r['entry'];audit.append([e.get('sourceName'),e.get('sourceVersion'),byid[e['sourceId']].get('updatedAt'),e.get('sourceUrl'),e['sheet'],e['row'],a['tab'],e['name']])
    sheets.append(('TIDP sources',worksheet(''.join(row(v,i+1,34 if i==0 else None) for i,v in enumerate(audit)),columns(8,36),freeze=1,filter_ref=f'A1:H{len(audit)}'),False))
    parts={'xl/styles.xml':LAYOUT['styles'],'xl/theme/theme1.xml':LAYOUT['theme']}
    for i,(_,xml,_) in enumerate(sheets):parts[f'xl/worksheets/sheet{i+1}.xml']=xml
    tags=[]
    for i,(name,_,hidden) in enumerate(sheets):tags.append(f'<sheet name="{esc(name)}" sheetId="{i+1}" r:id="rId{i+1}"'+(' state="hidden"' if hidden else '')+'/>')
    parts['xl/workbook.xml']=f'<workbook xmlns="{NS}" xmlns:r="{REL}"><bookViews><workbookView/></bookViews><sheets>'+''.join(tags)+'</sheets></workbook>'
    parts['xl/_rels/workbook.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i+1}" Type="{REL}/worksheet" Target="worksheets/sheet{i+1}.xml"/>' for i in range(len(sheets)))+f'<Relationship Id="styles" Type="{REL}/styles" Target="styles.xml"/><Relationship Id="theme" Type="{REL}/theme" Target="theme/theme1.xml"/></Relationships>'
    parts['_rels/.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    parts['[Content_Types].xml']='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(sheets)))+'</Types>'
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        for name,xml in parts.items():z.writestr(name,xml)
    return output.getvalue()
