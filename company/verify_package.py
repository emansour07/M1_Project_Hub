"""Verify the extracted release against its manifest before local modifications."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'MANIFEST.sha256.json').read_text(encoding='utf8'))
failed = []
for name, expected in manifest.items():
    path = (root / name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        failed.append(name)
    elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        failed.append(name)
if failed:
    raise SystemExit('Manifest verification failed: ' + ', '.join(failed))
print(f'Verified {len(manifest)} release files. Extra local files are not covered by this manifest.')
