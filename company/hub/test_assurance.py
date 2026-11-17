from django.test import TestCase,Client
from django.contrib.auth import get_user_model
from .models import Snapshot
from .assurance import validate,sync_issues,read
from unittest.mock import Mock
import json

class AssuranceTests(TestCase):
    def setUp(self):
        self.scope=[{'id':'Island-A33','code':'A33','proposed':'US1','name':'Accommodation','aliases':['A33','US1'],'ambiguous':[],'zone':'Island'}]
        Snapshot.objects.create(key='knowledge',data={'scope':{'rows':self.scope}})
        self.owner=get_user_model().objects.create_superuser('assurance-owner','owner@arx.ing','test-password')
        self.report={'kind':'rfi','batch':'Client RFIs','source':'client.xlsx','asOf':'2026-11-17','scopeId':'Island-A33','baseRevision':0,'rows':[{'id':'001','title':'Question','status':'Open','due':'2026-11-20'}]}
    def post(self,path,data):return self.client.post('/api/assurance/'+path,json.dumps(data),content_type='application/json')
    def test_owner_only_and_csrf(self):
        self.assertEqual(self.post('import',self.report).status_code,403)
        c=Client(enforce_csrf_checks=True);c.force_login(self.owner)
        self.assertEqual(c.post('/api/assurance/import',json.dumps(self.report),content_type='application/json').status_code,403)
    def test_preview_save_and_stale_reimport(self):
        self.client.force_login(self.owner)
        self.assertEqual(self.post('preview',self.report).json()['baseRevision'],0)
        self.assertEqual(self.post('import',self.report).status_code,200)
        self.assertEqual(self.post('import',self.report).status_code,400)
        self.report['baseRevision']=1;self.report['rows'][0]['status']='Closed'
        self.assertEqual(self.post('import',self.report).json()['report']['delta']['changed'],1)
        self.client.logout();self.assertEqual(len(self.client.get('/api/assurance').json()['reports'][0]['rows']),1)
    def test_invalid_dates_duplicate_and_unscoped(self):
        self.report['rows'][0]['due']='2026-02-31'
        with self.assertRaises(ValueError):validate(self.report,self.scope)
        self.report['rows'][0]['due']=None;self.report['rows'].append(dict(self.report['rows'][0]))
        with self.assertRaises(ValueError):validate(self.report,self.scope)
        self.report['rows'].pop();self.report['scopeId']='A51'
        with self.assertRaises(ValueError):validate(self.report,self.scope)
    def test_qaqc_requires_version_and_model(self):
        self.report['kind']='qaqc'
        with self.assertRaises(ValueError):validate(self.report,self.scope)
    def test_issue_sync_is_read_only_scoped_and_failure_retains_snapshot(self):
        client=Mock();client.call.return_value={'results':[{'id':'issue-one','title':'A33 issue','locationDetails':'Island A33','status':'open'},{'id':'issue-two','title':'Unknown','status':'open'}],'pagination':{'totalResults':2}}
        sync_issues(client);self.assertEqual(len(read('issues')['rows']),1);self.assertEqual(read('issues')['unassigned'],1)
        client.call.assert_called_once();self.assertNotIn('POST',str(client.call.call_args))
        Snapshot.objects.filter(key='assurance/issue-state').update(data={});client.call.return_value={'results':[],'pagination':{'totalResults':2}}
        with self.assertRaises(ValueError):sync_issues(client)
        self.assertEqual(len(read('issues')['rows']),1)
