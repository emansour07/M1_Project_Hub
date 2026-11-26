import json
from django.test import TestCase,Client
from django.contrib.auth import get_user_model
from .models import Snapshot
from .submissions import match,validate,attach

NAME='M1-102-SAP-US1-05-BM003-BNM-XX-900001'
class SubmissionTests(TestCase):
    def test_new_codes_normalization_and_serial_suggestions(self):
        scope=[dict(id='Island-A33',code='A33',proposed='US1',parcel='102',aliases=['A33','US1'])]
        e=dict(id='one',name='M1-102-SAP-US1-05-AR010-DWG-XX-000001')
        r={'rows':[{'name':'M1_FXX_ARX_USA_5_AR010_PDF_XX_1_REV02.pdf'}]}
        self.assertEqual(match([e],r,scope)['matched'],1)
        r={'rows':[{'name':e['name'].replace('000001','700001').replace('US1','USA')}]}
        m=match([e],r,scope,include_suggestions=True)
        self.assertEqual(m['matched'],0)
        self.assertEqual(m['unmatched'][0]['suggestions'][0]['id'],'one')
        r['mappings']=[dict(source=e['name'].replace('000001','700001'),target=e['name'])]
        self.assertEqual(match([e],r,scope)['matched'],1)
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

    def test_flexible_codes_titles_and_saved_matches(self):
        scope=[dict(id='Island-A33',code='A33',proposed='US1',parcel='102',aliases=['A33','US1'])]
        old=NAME.replace('-102-SAP-US1-','-FXX-ARX-A33-')
        report={'rows':[dict(name='cover.pdf',title='Drawing '+old+'-R00 title',date='2026-11-10',reference='1'),dict(name=old+'-R00.dwg',date='2026-11-10',reference='1')]}
        m=match(self.entries,report,scope);self.assertEqual(m['matched'],1);self.assertEqual(len(m['byId']['one']['history']),1)
        for bad in [NAME.replace('-102-','-121-'),NAME.replace('-05-','-42-'),NAME.replace('900001','900002')]:self.assertEqual(match(self.entries,{'rows':[{'name':bad}]},scope)['matched'],0)
        self.assertEqual(match(self.entries+[dict(self.entries[0],id='copy')],report,scope)['matched'],0)
        self.payload['mappings']=[dict(source=NAME.replace('900001','955011'),target=NAME)]
        self.payload['rows']=[dict(name=NAME.replace('900001','955011')+'.pdf',date='2026-11-10')]
        self.client.force_login(self.owner)
        response=self.client.post('/api/submissions/import',data=json.dumps(self.payload),content_type='application/json');self.assertEqual(response.status_code,200,response.content)
        saved=self.client.get('/api/submissions/workspace').json()['reports'][0];self.assertEqual(saved['mappings'],self.payload['mappings'])
        self.assertEqual(self.client.get('/api/submissions/search',{'q':'US1'}).json()['entries'][0]['name'],self.entries[0]['name'])
        self.assertEqual(attach({'entries':self.entries})['entries'][0]['arxSapacDate'],'2026-11-10')
        self.assertEqual(match([dict(self.entries[0],name=NAME.replace('900001','900004'))],validate(self.payload),scope)['matched'],0)
