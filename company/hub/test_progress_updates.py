import json
import uuid
from datetime import datetime,timezone as dtz
from django.test import TestCase,Client,override_settings
from django.contrib.auth import get_user_model
from .models import Snapshot,Editor,TrackerDraft,Outbox
from .progress_updates import submit,queue_requests,request_settings,mail_allowed

class ProgressUpdateTests(TestCase):
    def setUp(self):
        self.owner=get_user_model().objects.create_superuser('progress-owner','owner@example.com','local-test-password-only')
        self.client.force_login(self.owner)
        self.user={'owner':False,'email':'lead@example.com','assets':['Island-A48'],'disciplines':['Mechanical'],'fields':['log','overallCompletion']}
        Editor.objects.create(**{k:v for k,v in self.user.items() if k!='owner'})
        self.data={'source':{'version':33,'versionId':'tracker-v33'},'columns':[{'key':'log','label':'LOG %','type':'percent'}],'rows':[{'id':'one','name':'Example model','scopeId':'Island-A48','discipline':'Mechanical','fields':{}},{'id':'two','name':'Other asset','scopeId':'Island-A33','discipline':'Mechanical','fields':{}}]}
        Snapshot.objects.create(key='tracker',data=self.data)
    def payload(self):return {'sourceVersion':'tracker-v33','rows':[{'rowId':'one','requestId':str(uuid.uuid4()),'changes':{'log':0}}]}
    def test_private_and_csrf(self):
        c=Client(enforce_csrf_checks=True);c.force_login(self.owner)
        self.assertEqual(c.post('/api/progress/submit',json.dumps(self.payload()),content_type='application/json').status_code,403)
        self.client.logout();self.assertEqual(self.client.get('/api/progress/workspace').status_code,401)
    def test_retry_and_permissions(self):
        p=self.payload();submit(self.user,self.data,p);submit(self.user,self.data,p)
        self.assertEqual(TrackerDraft.objects.count(),1);self.assertEqual(TrackerDraft.objects.get().changes,{'log':0})
        for row_id,changes in [('two',{'log':.5}),('one',{'blocker':'No access'}),('one',{'log':1.1})]:
            q=self.payload();q['rows'][0].update(rowId=row_id,changes=changes)
            with self.assertRaises(ValueError):submit(self.user,self.data,q)
        p['sourceVersion']='old'
        with self.assertRaises(ValueError):submit(self.user,self.data,p)
    def test_batch_rolls_back_on_reused_reference(self):
        p=self.payload();submit(self.user,self.data,p);p['rows'][0]['changes']={'log':.7}
        with self.assertRaises(ValueError):submit(self.user,self.data,p)
        self.assertEqual(TrackerDraft.objects.get().changes,{'log':0})
    def test_workspace_adds_overall_completion(self):
        result=self.client.get('/api/progress/workspace').json()
        self.assertTrue(any(c['key']=='overallCompletion' for c in result['columns']))
    @override_settings(M1_MAIL_ENABLED=False)
    def test_disconnected_mail_is_disabled(self):
        self.assertEqual(queue_requests(),0)
        with self.assertRaises(ValueError):queue_requests('manual',str(uuid.uuid4()))
    @override_settings(M1_MAIL_ENABLED=True,PUBLIC_URL='https://internal.example')
    def test_weekly_once_and_manual_during_pause(self):
        cfg={'revision':0,'paused':False,'recipients':[self.user['email']],'subject':'Progress','message':'Please update'}
        request_settings(cfg)
        wed=datetime(2026,11,18,10,tzinfo=dtz.utc)
        self.assertEqual(queue_requests(now=wed.replace(hour=9)),0)
        self.assertEqual(queue_requests(now=wed),1);self.assertEqual(queue_requests(now=wed),0)
        request_settings({**cfg,'revision':1,'paused':True})
        self.assertEqual(queue_requests(now=wed),0)
        ident=str(uuid.uuid4());self.assertEqual(queue_requests('manual',ident,wed),1);self.assertEqual(queue_requests('manual',ident,wed),0)
        row=Outbox.objects.get(key__startswith='progress:manual:');self.assertTrue(mail_allowed(row))
        Editor.objects.update(active=False);self.assertFalse(mail_allowed(row))
