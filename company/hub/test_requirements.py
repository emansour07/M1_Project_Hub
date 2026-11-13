import json
from django.test import TestCase,Client
from django.contrib.auth import get_user_model
from .models import Snapshot,Requirement,RequirementEvent
from .requirements import validate

class RequirementsTests(TestCase):
    def setUp(self):
        self.owner=get_user_model().objects.create_superuser('req-owner','owner@example.com','local-test-password-only')
        self.client.force_login(self.owner)
        self.scope=[{'id':'Island-A48','name':'Gatehouse','zone':'Island','code':'A48'}]
        Snapshot.objects.create(key='knowledge',data={'scope':{'rows':self.scope}})
        self.data={'title':'Test requirement','scopeId':'Island-A48','discipline':'Structure','system':'System','element':'Element','information':'Needed data','modelUse':'Model development','status':'Draft'}
    def post(self,payload):return self.client.post('/api/requirements',json.dumps(payload),content_type='application/json')
    def test_anonymous_data_is_private(self):
        self.client.logout();self.assertEqual(self.client.get('/api/requirements').status_code,401)
    def test_csrf_required(self):
        client=Client(enforce_csrf_checks=True);client.force_login(self.owner)
        self.assertEqual(client.post('/api/requirements',json.dumps({'revision':0,'data':self.data}),content_type='application/json').status_code,403)
    def test_save_history_conflict_and_comment(self):
        first=self.post({'revision':0,'data':self.data});self.assertEqual(first.status_code,200);row=first.json()
        second=self.post({'id':row['id'],'revision':1,'data':{**self.data,'notes':'Changed'}});self.assertEqual(second.status_code,200)
        self.assertEqual(self.post({'id':row['id'],'revision':1,'data':self.data}).status_code,400)
        self.assertEqual(Requirement.objects.get().data['notes'],'Changed')
        comment=self.client.post('/api/requirements/'+row['id']+'/comments',json.dumps({'text':'Coordination note'}),content_type='application/json');self.assertEqual(comment.status_code,200)
        self.assertEqual(RequirementEvent.objects.count(),3)
    def test_scope_validation_and_invalid_links(self):
        user={'owner':False,'assets':['Island-A48'],'disciplines':['Structure']}
        for change in [{'scopeId':'*'},{'discipline':'Electrical'},{'reference':'javascript:test'},{'dueDate':'2026-02-30'}]:
            with self.assertRaises(ValueError):validate({**self.data,**change},user,self.scope)
