"""M1-only Autodesk adapter. Never accepts an API host or project from a browser."""
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from django.conf import settings
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

API = 'https://developer.api.autodesk.com'
TOKEN_URL = API + '/authentication/v2/token'
ROOTS = {'progress1': 'urn:adsk.wipemea:fs.folder:co.VehAR6QsSlSwFkACDHnCtQ',
         'progress2': 'urn:adsk.wipemea:fs.folder:co.6wa3eF4wR-eI0UzMqkyB7g'}
SOURCES = {'midp': 'urn:adsk.wipemea:dm.lineage:Kx4epOWERrSmEs2pLoS5SA',
           'tracker': 'urn:adsk.wipemea:dm.lineage:8Uhmx_-pRTGvI__MKFA_-A'}
quote = lambda s: urllib.parse.quote(str(s), safe='')
b64 = lambda v: base64.urlsafe_b64encode(v).decode().rstrip('=')

class ProviderError(Exception): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

def request(url, method='GET', body=None, headers=None, limit=32_000_000):
    try:
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url, data=body, method=method, headers=headers or {}), timeout=60) as response:
            data = response.read(limit + 1)
            if len(data) > limit: raise ProviderError('The Autodesk response exceeds the configured size limit.')
            return data
    except urllib.error.HTTPError as exc:
        raise ProviderError(f'Autodesk request failed ({exc.code}).') from None
    except (TimeoutError, urllib.error.URLError):
        raise ProviderError('Autodesk did not confirm the request. Check its result before retrying.') from None

class APS:
    def __init__(self, scopes=('data:read',)):
        self.scopes = scopes
        self._token = None
    def token(self):
        if self._token: return self._token
        c = settings.APS_CONFIG
        if not all(c.get(k) for k in ['APS_CLIENT_ID','APS_CLIENT_SECRET','APS_SSA_ID','APS_SSA_KID','APS_SSA_PRIVATE_KEY_PATH']):
            raise ProviderError('The company server Autodesk connection is not configured.')
        header = b64(json.dumps({'alg':'RS256','kid':c['APS_SSA_KID']}).encode())
        claims = b64(json.dumps({'iss':c['APS_CLIENT_ID'],'sub':c['APS_SSA_ID'],'aud':TOKEN_URL,'exp':int(time.time())+300,'scope':list(self.scopes)}).encode())
        value = header + '.' + claims
        key = serialization.load_pem_private_key(Path(c['APS_SSA_PRIVATE_KEY_PATH']).read_bytes(), password=None)
        assertion = value + '.' + b64(key.sign(value.encode(), padding.PKCS1v15(), hashes.SHA256()))
        auth = base64.b64encode((c['APS_CLIENT_ID']+':'+c['APS_CLIENT_SECRET']).encode()).decode()
        data = request(TOKEN_URL, 'POST', urllib.parse.urlencode({'grant_type':'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion':assertion,'scope':' '.join(self.scopes)}).encode(), {'Authorization':'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'})
        self._token = json.loads(data)['access_token']
        return self._token
    def call(self, path, method='GET', data=None):
        if not path.startswith('/') or path.startswith('//'): raise ValueError('Invalid Autodesk API path.')
        headers = {'Authorization':'Bearer '+self.token(), 'Region':settings.M1_REGION,
                   'Content-Type':'application/vnd.api+json' if path.startswith('/data/') else 'application/json'}
        return json.loads(request(API+path, method, json.dumps(data).encode() if data is not None else None, headers))
    @property
    def project(self): return '/data/v1/projects/' + quote('b.'+settings.M1_PROJECT_ID)
    def members(self):
        offset = 0
        while True:
            value = self.call(f'/construction/admin/v1/projects/{settings.M1_PROJECT_ID}/users?limit=200&offset={offset}')
            rows = value.get('results', [])
            yield from rows
            offset += len(rows)
            if offset >= value.get('pagination', {}).get('totalResults', offset) or not rows: break
            if offset > 10000: raise ProviderError('Project user pagination exceeded the safety limit.')
    def add_member(self, email, profile):
        body = {'email':email, 'roleIds':[profile.role_id], 'products':[{'key':'docs','access':'member'}]}
        if profile.company_id: body['companyId'] = profile.company_id
        return self.call('/construction/admin/v1/projects/'+settings.M1_PROJECT_ID+'/users', 'POST', body)
    def contents(self, folder):
        path = self.project+'/folders/'+quote(folder)+'/contents?page[limit]=200'
        for _ in range(200):
            page = self.call(path)
            versions = {v['id']:v for v in page.get('included',[]) if v.get('type')=='versions'}
            for item in page.get('data',[]):
                yield {**item,'_tip':versions.get(item.get('relationships',{}).get('tip',{}).get('data',{}).get('id'))}
            nxt = page.get('links', {}).get('next')
            if isinstance(nxt, dict): nxt = nxt.get('href')
            if not nxt: return
            parsed = urllib.parse.urlsplit(nxt)
            if parsed.scheme != 'https' or parsed.netloc != 'developer.api.autodesk.com' or not parsed.path.startswith(self.project+'/folders/'):
                raise ProviderError('Unexpected Autodesk pagination URL.')
            path = parsed.path + '?' + parsed.query
        raise ProviderError('Folder pagination exceeded the safety limit.')
    def verify_destination(self, folder, root):
        seen = set()
        for _ in range(40):
            if folder == ROOTS[root]: return True
            if folder in seen: break
            seen.add(folder)
            data = self.call(self.project+'/folders/'+quote(folder)+'/parent').get('data') or {}
            folder = data.get('id')
            if not folder: break
        raise ProviderError('This destination is not inside the selected M1 Shared root.')
    def tip(self, item): return self.call(self.project+'/items/'+quote(item)+'/tip')['data']
    def find_file(self, folder, name):
        found = [r for r in self.contents(folder) if r.get('type') == 'items' and (r.get('attributes',{}).get('displayName') or r.get('attributes',{}).get('name','')).casefold() == name.casefold()]
        if len(found) > 1: raise ProviderError('Multiple matching files exist. Resolve the folder before uploading.')
        return found[0] if found else None
    @staticmethod
    def storage_path(urn):
        prefix = 'urn:adsk.objects:os.object:'
        if not urn.startswith(prefix) or '/' not in urn[len(prefix):]: raise ProviderError('Invalid Autodesk storage location.')
        bucket, key = urn[len(prefix):].split('/',1)
        return '/oss/v2/buckets/'+quote(bucket)+'/objects/'+quote(key)
    @staticmethod
    def signed_url(url):
        p = urllib.parse.urlsplit(url)
        if p.scheme != 'https' or not (p.hostname or '').endswith('.amazonaws.com') or p.username or p.port not in (None,443):
            raise ProviderError('Unexpected Autodesk transfer host.')
        return url
    def download(self, item):
        tip = self.tip(item)
        if tip.get('attributes',{}).get('storageSize',0) > 25_000_000: raise ProviderError('Workbook exceeds 25 MB.')
        path = self.storage_path(tip['relationships']['storage']['data']['id'])
        signed = self.call(path+'/signeds3download')
        return request(self.signed_url(signed['url']), limit=25_000_000), tip
    def upload_storage(self, folder, filename, file):
        storage = self.call(self.project+'/storage','POST',{'jsonapi':{'version':'1.0'},'data':{'type':'objects','attributes':{'name':filename},'relationships':{'target':{'data':{'type':'folders','id':folder}}}}})['data']['id']
        path = self.storage_path(storage)
        # Stream 8 MB chunks; model files do not need to fit in server RAM.
        parts = max(1, (file.size + 8*1024*1024-1)//(8*1024*1024))
        upload_key = None
        sent = 0
        for first in range(1, parts+1, 25):
            n = min(25, parts-first+1)
            query = {'parts':n,'firstPart':first}
            if upload_key: query['uploadKey'] = upload_key
            signed = self.call(path+'/signeds3upload?'+urllib.parse.urlencode(query))
            upload_key = signed['uploadKey']
            if len(signed['urls']) != n: raise ProviderError('Incomplete upload destinations.')
            for url in signed['urls']:
                chunk = file.read(8*1024*1024)
                sent += len(chunk)
                request(self.signed_url(url),'PUT',chunk,limit=1_000_000)
        if sent != file.size: raise ProviderError('Uploaded size did not match the selected file.')
        self.call(path+'/signeds3upload','POST',{'uploadKey':upload_key})
        return storage
    def commit_file(self, folder, name, storage, item=None):
        version = {'type':'versions','attributes':{'name':name,'extension':{'type':'versions:autodesk.bim360:File','version':'1.0'}},'relationships':{'storage':{'data':{'type':'objects','id':storage}}}}
        if item:
            version['relationships']['item'] = {'data':{'type':'items','id':item}}
            return self.call(self.project+'/versions','POST',{'jsonapi':{'version':'1.0'},'data':version})
        version['id'] = '1'
        body = {'jsonapi':{'version':'1.0'},'data':{'type':'items','attributes':{'displayName':name,'extension':{'type':'items:autodesk.bim360:File','version':'1.0'}},'relationships':{'tip':{'data':{'type':'versions','id':'1'}},'parent':{'data':{'type':'folders','id':folder}}}},'included':[version]}
        return self.call(self.project+'/items','POST',body)
