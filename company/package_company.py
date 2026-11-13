"""Package only deployable source/assets. Excludes databases, credentials and raw workbooks."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
destination=Path(sys.argv[1]).resolve()
destination.parent.mkdir(parents=True,exist_ok=True)
files=[]
for path in (root/'company').rglob('*'):
    if not path.is_file():continue
    rel=path.relative_to(root)
    if any(part in ('private','__pycache__','staticfiles','.venv') for part in rel.parts):continue
    if path.suffix in ('.py','.html','.txt','.md') or path.name in ('.env.example','requirements-schema.json'):files.append((path,rel.as_posix()))
for path in (root/'pages').rglob('*'):
    if path.is_file() and path.suffix in ('.html','.js','.mjs','.css','.svg','.ico') and path.name!='M1_Project_Hub_Preview.html':
        files.append((path,path.relative_to(root).as_posix()))
chart=root/'company/private/media/orgchart.svg'
if chart.exists():files.append((chart,'company/private/media/orgchart.svg'))
config=(root/'pages/config.js').read_text(encoding='utf8')
if 'workers.dev' in config or 'chatgpt.site' in config or '"companyServer":true' not in config:
    raise SystemExit('Run node build.cjs --company before packaging.')
css=(root/'pages/style.css').read_text(encoding='utf8')
if '@import' in css or 'fonts.googleapis.com' in css or 'fonts.gstatic.com' in css:
    raise SystemExit('Company frontend must not load external styles or fonts.')
manifest={name:hashlib.sha256(path.read_bytes()).hexdigest() for path,name in files}
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as z:
    for path,name in files:z.write(path,name)
    z.writestr('MANIFEST.sha256.json',json.dumps(manifest,indent=2))
print(json.dumps({'package':str(destination),'files':len(files),'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}))
