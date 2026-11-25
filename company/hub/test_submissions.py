import json
from django.test import TestCase,Client
from django.contrib.auth import get_user_model
from .models import Snapshot
from .submissions import match,validate,attach

NAME='M1-102-SAP-US1-05-BM003-BNM-XX-900001'
class SubmissionTests(TestCase):
    def setUp(self):
        self.entries=[dict(id='one',name=NAME+'-R00',scopeId='Island-A33',discipline='ARCH')]
        Snapshot.objects.create(key='midp',data={'entries':self.entries})
        self.owner=get_user_model().objects.create_superuser(username='owner',email='owner@example.test',password='test-only-credential')
        self.payload=dict(stage='arxSapac',source='log.xlsx',asOf='2026-11-25',baseRevision=0,rows=[dict(name=NAME+'-R00.rvt',date='2026-11-10',reference='1'),dict(name=NAME+'-R01.rvt',date='2026-11-20',reference='2'),dict(name=NAME+'-R01.nwc',date='2026-11-20',reference='2')])
    def test_dates_history_and_ambiguity(self):
        m=match(self.entries,validate(self.payload));self.assertEqual(m['byId']['one']['date'],'2026-11-20');self.assertEqual(len(m['byId']['one']['history']),2)
        ambiguous=match(self.entries+[dict(self.entries[0],id='two')],validate(self.payload));self.assertEqual(ambiguous['matched'],0);self.assertEqual(len(ambiguous['ambiguous']),3)
    def test_owner_publish_replace_and_public_snapshot(self):
        self.assertEqual(self.client.post('/api/submissions/import',data=json.dumps(self.payload),content_type='application/json').status_code,403)
        self.client.force_login(self.owner)
        preview=self.client.post('/api/submissions/preview',data=json.dumps(self.payload),content_type='application/json');self.assertEqual(preview.status_code,200);self.assertEqual(preview.json()['matched'],1)
        self.assertEqual(self.client.get('/api/submissions/workspace').json()['reports'],[])
        response=self.client.post('/api/submissions/import',data=json.dumps(self.payload),content_type='application/json');self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(self.client.post('/api/submissions/import',data=json.dumps(self.payload),content_type='application/json').status_code,400)
        self.payload['baseRevision']=1;self.payload['rows']=self.payload['rows'][1:]
        self.assertEqual(self.client.post('/api/submissions/import',data=json.dumps(self.payload),content_type='application/json').status_code,200)
        self.client.logout();data=attach({'entries':self.entries});self.assertEqual(data['entries'][0]['arxSapacDate'],'2026-11-20');self.assertEqual(len(data['entries'][0]['submissions']['arxSapac']['history']),1)
        self.assertEqual(self.client.get('/api/submissions/workspace').status_code,403)
    def test_csrf_enforced(self):
        c=Client(enforce_csrf_checks=True);c.force_login(self.owner);self.assertEqual(c.post('/api/submissions/import',data=json.dumps(self.payload),content_type='application/json').status_code,403)
    def test_void_and_future(self):
        p={**self.payload,'rows':[{'name':NAME,'date':'2026-11-01','workflowStatus':'VOID'},*self.payload['rows']]};self.assertEqual(validate(p)['voidCount'],1)
        with self.assertRaises(ValueError):validate({**self.payload,'rows':[{'name':NAME,'date':'2030-01-01'}]})
