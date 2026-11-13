"""Refresh browser cache tokens after editing the packaged frontend source."""
import re
import sys
from pathlib import Path

if len(sys.argv) != 2 or not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', sys.argv[1]):
    raise SystemExit('Usage: python company/version_assets.py <release-id> (letters, numbers, dots, underscores, hyphens)')
root = Path(__file__).resolve().parents[1] / 'pages'
revision = sys.argv[1]
for path in root.iterdir():
    if path.suffix not in ('.html', '.js', '.mjs') or path.name == 'M1_Project_Hub_Preview.html':
        continue
    old = path.read_text(encoding='utf8')
    new = re.sub(r'([\w./-]+\.(?:css|js|mjs))\?v=[A-Za-z0-9._-]+', lambda m: m[1] + '?v=' + revision, old)
    if new != old:
        path.write_text(new, encoding='utf8')
print('Updated frontend cache tokens. Regenerate the release package/manifest, then collectstatic on deployment.')
