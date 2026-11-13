"""Render supplied Excel DrawingML at its original positions; no inferred reporting lines."""
import io
import html
import textwrap
import zipfile
from defusedxml import ElementTree as ET

NS = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main','x':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}

def render_orgchart(source):
    with zipfile.ZipFile(source) as z:
        info = z.getinfo('xl/drawings/drawing1.xml')
        if info.file_size > 5_000_000: raise ValueError('Organisation chart drawing is too large.')
        root = ET.fromstring(z.read(info))
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
        extents.append((x,y,x+w,y+h))
        colour = props.find('a:ln/a:solidFill/a:srgbClr',NS)
        stroke = '#'+colour.get('val') if colour is not None else '#909090'
        if connector:
            x1,x2 = (x+w,x) if transform.get('flipH')=='1' else (x,x+w)
            y1,y2 = (y+h,y) if transform.get('flipV')=='1' else (y,y+h)
            dash = ' stroke-dasharray="5 4"' if props.find('a:ln/a:prstDash',NS) is not None else ''
            geom = props.find('a:prstGeom',NS)
            if geom is not None and geom.get('prst','').startswith('bentConnector'):
                path = f'M{x1},{y1} H{(x1+x2)/2} V{y2} H{x2}'
            else: path = f'M{x1},{y1} L{x2},{y2}'
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
