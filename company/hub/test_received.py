from django.test import TestCase
from django.contrib.auth import get_user_model
from .models import Snapshot
from .received import validate,compare,model_key
class ReceivedTests(TestCase):
    def setUp(self):
        self.asset={'id':'Island-A33','code':'A33','name':'Accommodation','zone':'Island','parcel':'102','aliases':['A33','US1'],'ambiguous':[],'proposed':'US1'}
        self.row={'id':'r1','name':'M1-102-HES-A33-42-BM010-BNM/BGM-XX-933011','description':'Accommodation','source':'HES - Island','scopeId':'Island-A33','discipline':'Architecture','revision':'R00','formats':{'native':{'sourceAvailable':True,'workbookReceived':True}}}
        self.data={'sourceCheckedAt':123,'rows':[self.row]}
        Snapshot.objects.create(key='knowledge',data={'scope':{'rows':[self.asset]}})
    def test_scoped_readonly_import_and_receipt_states(self):
        data=validate(self.data,[self.asset]);row=compare(data['rows'],[],123)[0]
        self.assertEqual(row['status'],'Source only');self.assertEqual(row['accFormats'],0)
        self.assertEqual(model_key(self.row['name'],'Island-A33'),model_key(self.row['name'].replace('BNM/BGM','BGM')+'-R01.ifc','Island-A33'))
        self.data['rows'].append({**self.row,'id':'other','name':self.row['name'].replace('-102-','-011-')})
        self.assertEqual(len(validate(self.data,[self.asset])['rows']),1)
    def test_owner_import_public_view_and_scope_change(self):
        self.assertEqual(self.client.put('/api/received/import',self.data,content_type='application/json').status_code,403)
        owner=get_user_model().objects.create_user('owner',is_superuser=True);self.client.force_login(owner)
        self.assertEqual(self.client.put('/api/received/import',self.data,content_type='application/json').status_code,200)
        self.client.logout();self.assertEqual(len(self.client.get('/api/received').json()['rows']),1)
        Snapshot.objects.filter(key='knowledge').update(data={'scope':{'rows':[]}})
        self.assertEqual(self.client.get('/api/received').json()['rows'],[])
