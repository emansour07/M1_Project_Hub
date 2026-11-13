"""Render supplied Excel DrawingML at its original positions; no inferred reporting lines."""
import math
import posixpath
import html
import textwrap
import zipfile
from defusedxml import ElementTree as ET

NS = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main','x':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def worksheet_for_drawing(z,drawing):
    for name in z.namelist():
        if not name.startswith('xl/worksheets/_rels/') or not name.endswith('.xml.rels'): continue
        for rel in ET.fromstring(z.read(name)):
            target=posixpath.normpath(posixpath.join('xl/worksheets',rel.get('Target','')))
            if target==drawing:
                return ET.fromstring(z.read('xl/worksheets/'+posixpath.basename(name)[:-5]))
    return None

def anchor_bounds(anchor,sheet):
    """Cell anchors are authoritative after Excel moves/resizes rows and columns.

    Cached a:xfrm offsets in the supplied workbook retain obsolete positions.
    """
    start,end=anchor.find('x:from',NS),anchor.find('x:to',NS)
    if sheet is None or start is None or end is None: return None
    fmt=sheet.find('s:sheetFormatPr',NS)
    default_width=float(fmt.get('defaultColWidth','8.43')) if fmt is not None else 8.43
    default_height=float(fmt.get('defaultRowHeight','15')) if fmt is not None else 15
    cols=sheet.findall('s:cols/s:col',NS);rows={int(r.get('r'))-1:r for r in sheet.findall('s:sheetData/s:row',NS)}
    def col_width(i):
        c=next((c for c in cols if int(c.get('min'))-1<=i<int(c.get('max'))),None)
        if c is not None and c.get('hidden')=='1':return 0
        w=float(c.get('width',default_width)) if c is not None else default_width
        return math.floor((256*w+math.floor(128/7))/256*7)+5
    def row_height(i):
        r=rows.get(i)
        return 0 if r is not None and r.get('hidden')=='1' else float(r.get('ht',default_height) if r is not None else default_height)*96/72
    def point(n):
        col,row=int(n.find('x:col',NS).text),int(n.find('x:row',NS).text)
        return (sum(col_width(i) for i in range(col))+int(n.find('x:colOff',NS).text)/9525,sum(row_height(i) for i in range(row))+int(n.find('x:rowOff',NS).text)/9525)
    x,y=point(start);right,bottom=point(end)
    return x,y,right-x,bottom-y

def connector_points(bounds, transform, geom):
    """Transform preset connector geometry into its current cell-anchor bounds."""
    x,y,w,h=bounds
    angle=int(transform.get('rot','0'))/60000
    quarter=round(angle/90)%2==1
    width,height=(h,w) if quarter else (w,h)
    kind=geom.get('prst','') if geom is not None else ''
    adjustment=0.5
    if geom is not None:
        for gd in geom.findall('a:avLst/a:gd',NS):
            if gd.get('name')=='adj1' and gd.get('fmla','').startswith('val '):
                adjustment=float(gd.get('fmla').split()[1])/100000
    if kind=='bentConnector2':points=[(0,0),(width,0),(width,height)]
    elif kind=='bentConnector3':points=[(0,0),(width*adjustment,0),(width*adjustment,height),(width,height)]
    else:points=[(0,0),(width,height)]
    radians=math.radians(angle);c,s=math.cos(radians),math.sin(radians)
    result=[]
    for px,py in points:
        if transform.get('flipH')=='1':px=width-px
        if transform.get('flipV')=='1':py=height-py
        px-=width/2;py-=height/2
        result.append((x+w/2+px*c-py*s,y+h/2+px*s+py*c))
    return result

def render_orgchart(source):
    with zipfile.ZipFile(source) as z:
        info = z.getinfo('xl/drawings/drawing1.xml')
        if info.file_size > 5_000_000: raise ValueError('Organisation chart drawing is too large.')
        root = ET.fromstring(z.read(info))
        sheet = worksheet_for_drawing(z,'xl/drawings/drawing1.xml')
    scale = 9525
    shapes, lines, extents, names = [], [], [], []
    for anchor in root:
        node = anchor.find('x:sp',NS)
        connector = False
        if node is None:
            node = anchor.find('x:cxnSp',NS)
            connector = True
        if node is None: continue
        props = node.find('x:spPr',NS)
        transform = props.find('a:xfrm',NS) if props is not None else None
        if transform is None: continue
        off, ext = transform.find('a:off',NS), transform.find('a:ext',NS)
        if off is None or ext is None: continue
        x,y,w,h = [int(v)/scale for v in [off.get('x'),off.get('y'),ext.get('cx'),ext.get('cy')]]
        current=anchor_bounds(anchor,sheet)
        if current is not None:x,y,w,h=current
        extents.append((x,y,x+w,y+h))
        colour = props.find('a:ln/a:solidFill/a:srgbClr',NS)
        stroke = '#'+colour.get('val') if colour is not None else '#909090'
        if connector:
            dash = ' stroke-dasharray="5 4"' if props.find('a:ln/a:prstDash',NS) is not None else ''
            geom = props.find('a:prstGeom',NS)
            points=connector_points((x,y,w,h),transform,geom)
            path=' '.join(('M' if i==0 else 'L')+f'{px:.4f},{py:.4f}' for i,(px,py) in enumerate(points))
            lines.append(f'<path d="{path}" stroke="{stroke}" fill="none"{dash}/>')
            continue
        paragraphs = [''.join(p.itertext()) for p in []]
        paragraphs = [''.join(t.text or '' for t in p.findall('.//a:t',NS)) for p in node.findall('x:txBody/a:p',NS)]
        paragraphs = [p for p in paragraphs if p.strip()]
        if not paragraphs: continue
        names.append(' · '.join(paragraphs))
        fill_node = props.find('a:solidFill/a:srgbClr',NS)
        fill = '#'+fill_node.get('val') if fill_node is not None else '#ffffff'
        wrapped = [line for p in paragraphs for line in textwrap.wrap(p,max(8,int(w/6.2)),break_long_words=False)]
        size = min(12,max(6,(h-6)/max(1,len(wrapped))/1.2))
        linesp = size*1.2
        top = y+(h-linesp*len(wrapped))/2+size
        title = html.escape(' · '.join(paragraphs))
        text = ''.join(f'<text x="{x+w/2}" y="{top+i*linesp}" text-anchor="middle" font-size="{size}" fill="#111">{html.escape(t)}</text>' for i,t in enumerate(wrapped))
        shapes.append(f'<g><title>{title}</title><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{fill}" stroke="{stroke}"/>{text}</g>')
    if not extents: raise ValueError('No positioned organisation-chart shapes were found.')
    x0,y0 = min(a[0] for a in extents)-10,min(a[1] for a in extents)-10
    width,height = max(a[2] for a in extents)-x0+10,max(a[3] for a in extents)-y0+10
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {width} {height}" role="img" aria-label="M1 organisation chart from the supplied workbook" font-family="Arial,sans-serif"><rect x="{x0}" y="{y0}" width="{width}" height="{height}" fill="white"/>'+''.join(lines+shapes)+'</svg>'
    return svg, names
