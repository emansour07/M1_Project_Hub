from datetime import datetime, timezone as tz
from unittest.mock import Mock
from django.test import TestCase, Client, override_settings
from django.contrib.auth import get_user_model
from .models import AccessProfile, AccessRequest, Outbox, ReminderSettings, Editor, Snapshot
from .services import decide_access, provision, queue_reminders, send_outbox, sync_roles
from .auth import allowed

@override_settings(M1_NOTIFICATION_EMAIL='eslam.mansour@arx.ing',DEFAULT_FROM_EMAIL='m1@arx.ing')
class AccessTests(TestCase):
    def setUp(self):
        Snapshot.objects.create(key='tracker',data={'rows':[{'discipline':'Structure'}]})
        self.role=AccessProfile.objects.create(name='Structural engineer',role_id='actual-project-role-id',active=True)
        self.row=AccessRequest.objects.create(full_name='Test User',email='test@example.com',company='Test',requested_role=self.role.name,discipline='Structure',profile=self.role)
        self.owner=get_user_model().objects.create_superuser('owner','owner@example.com','test-pass-1234')
    def test_get_email_link_never_approves(self):
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(f'/owner/access/{self.row.id}/').status_code,200)
        self.row.refresh_from_db();self.assertEqual(self.row.status,'pending')
    def test_public_cannot_approve(self):
        self.assertEqual(self.client.post(f'/owner/access/{self.row.id}/',{'action':'approve'}).status_code,302)
        self.row.refresh_from_db();self.assertEqual(self.row.status,'pending')
    def test_csrf_blocks_approval(self):
        c=Client(enforce_csrf_checks=True);c.force_login(self.owner)
        self.assertEqual(c.post(f'/owner/access/{self.row.id}/',{'action':'approve'}).status_code,403)
    def test_request_uses_real_role_and_normalizes_email(self):
        response=self.client.post('/access-request/',{'full_name':'New User','email':'New@Example.com','company':'Test','profile':str(self.role.id),'discipline':'Structure'})
        self.assertEqual(response.status_code,200)
        row=AccessRequest.objects.get(email='new@example.com')
        self.assertEqual(row.status,'pending');self.assertEqual(row.profile,self.role)
        self.assertEqual(Outbox.objects.get().recipient,'eslam.mansour@arx.ing')
    def test_arbitrary_role_is_rejected(self):
        self.client.post('/access-request/',{'full_name':'New User','email':'new@example.com','company':'Test','profile':'999','discipline':'Structure'})
        self.assertFalse(AccessRequest.objects.filter(email='new@example.com').exists())
    def test_owner_can_approve_once(self):
        decide_access(self.row.id,self.owner.email,True)
        with self.assertRaises(ValueError): decide_access(self.row.id,self.owner.email,True)
    @override_settings(M1_PROVISION_ENABLED=True)
    def test_provision_is_idempotent_and_does_not_escalate_existing_member(self):
        decide_access(self.row.id,self.owner.email,True)
        provider=Mock();provider.members.return_value=iter([{'email':self.row.email,'id':'existing'}])
        self.assertTrue(provision(self.row.id,provider));self.assertFalse(provision(self.row.id,provider))
        provider.add_member.assert_not_called()
        self.row.refresh_from_db();self.assertEqual(self.row.status,'already_member')
    @override_settings(M1_PROVISION_ENABLED=True)
    def test_uncertain_provision_never_retries_automatically(self):
        decide_access(self.row.id,self.owner.email,True)
        provider=Mock();provider.members.return_value=[];provider.add_member.side_effect=TimeoutError()
        self.assertFalse(provision(self.row.id,provider));self.assertFalse(provision(self.row.id,provider))
        self.assertEqual(provider.add_member.call_count,1)
        self.row.refresh_from_db();self.assertEqual(self.row.status,'needs_attention')
    @override_settings(M1_PROVISION_ENABLED=False)
    def test_disabled_provision_stays_queued(self):
        decide_access(self.row.id,self.owner.email,True)
        provider=Mock();self.assertFalse(provision(self.row.id,provider));provider.members.assert_not_called()
        self.row.refresh_from_db();self.assertEqual(self.row.status,'approved')
    def test_roles_are_sourced_from_project_members(self):
        provider=Mock();provider.members.return_value=[{'roles':[{'id':'r1','name':'Architect'}]},{'roles':[{'id':'r1','name':'Architect'}]}]
        self.assertEqual(sync_roles(provider),1)
        self.assertEqual(list(AccessProfile.objects.filter(active=True).values_list('role_id',flat=True)),['r1'])

class ReminderTests(TestCase):
    def setUp(self): self.config=ReminderSettings.objects.create(paused=False,sender='m1@arx.ing',recipients='a@example.com\nb@example.com')
    def test_wednesday_dubai_time_and_no_duplicate(self):
        self.assertEqual(queue_reminders(datetime(2026,11,18,9,59,tzinfo=tz.utc)),0)
        self.assertEqual(queue_reminders(datetime(2026,11,18,10,0,tzinfo=tz.utc)),2)
        self.assertEqual(queue_reminders(datetime(2026,11,18,10,1,tzinfo=tz.utc)),0)
        self.assertEqual(queue_reminders(datetime(2026,11,19,10,0,tzinfo=tz.utc)),0)
    def test_pause_stops_queueing(self):
        self.config.paused=True;self.config.save()
        self.assertEqual(queue_reminders(datetime(2026,11,18,10,0,tzinfo=tz.utc)),0)
    @override_settings(M1_MAIL_ENABLED=False)
    def test_disabled_mail_never_sends(self):
        queue_reminders(datetime(2026,11,18,10,0,tzinfo=tz.utc));self.assertEqual(send_outbox(),0)
        self.assertEqual(Outbox.objects.filter(state='pending').count(),2)
    def test_sender_restricted_to_company_domain(self):
        self.config.sender='wrong@example.com'
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError): self.config.full_clean()

class PermissionTests(TestCase):
    def test_editor_is_limited_to_both_asset_and_discipline(self):
        u={'owner':False,'assets':['a'],'disciplines':['Structure']}
        self.assertTrue(allowed(u,'a','Structure'));self.assertFalse(allowed(u,'b','Structure'));self.assertFalse(allowed(u,'a','Architecture'))
        self.assertFalse(allowed(None,'a','Structure'))
class CompanyAssignmentTests(TestCase):
    def setUp(self):
        from .companies import defaults
        self.config=defaults()
        Snapshot.objects.create(key='knowledge',data={'scope':{'rows':[{'id':a['assetId'],'zone':'Island','code':a['assetId'].split('-')[1],'party':'ARX','name':'Test asset'} for a in self.config['assignments']]}})
        self.owner=get_user_model().objects.create_superuser('company-owner','owner@example.com','local-test-password')
    def test_public_read_but_owner_only_write(self):
        self.assertEqual(self.client.get('/api/companies').status_code,200)
        self.assertEqual(self.client.put('/api/operations/companies',self.config,content_type='application/json').status_code,401)
        self.client.force_login(self.owner)
        self.assertEqual(self.client.put('/api/operations/companies',self.config,content_type='application/json').status_code,200)
        self.assertEqual(self.client.put('/api/operations/companies',self.config,content_type='application/json').status_code,409)
    def test_unknown_assets_and_colours_rejected_and_baseline_unchanged(self):
        self.client.force_login(self.owner)
        self.config['companies'][0]['color']='red;display:none'
        self.assertEqual(self.client.put('/api/operations/companies',self.config,content_type='application/json').status_code,400)
        self.assertEqual(Snapshot.objects.get(key='knowledge').data['scope']['rows'][0]['party'],'ARX')

class OrganisationAnchorTests(TestCase):
    def test_rotated_connector_joins_technical_manager_to_discipline_header(self):
        from .orgchart import connector_points
        from defusedxml.ElementTree import fromstring
        transform=fromstring('<xfrm rot="5400000" flipH="1" flipV="1"/>')
        geom=fromstring('<prstGeom xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" prst="bentConnector3"><avLst><gd name="adj1" fmla="val 13703"/></avLst></prstGeom>')
        points=connector_points((200.66656,152.4001,391.26667,201.06667),transform,geom)
        self.assertAlmostEqual(points[0][0],200.66656)
        self.assertAlmostEqual(points[0][1],353.46677)
        self.assertAlmostEqual(points[-1][0],591.93323)
        self.assertAlmostEqual(points[-1][1],152.4001)
        self.assertAlmostEqual(points[1][1],points[2][1])

    def test_current_cell_anchors_override_obsolete_drawing_offsets(self):
        from .orgchart import anchor_bounds
        from defusedxml.ElementTree import fromstring
        anchor=fromstring('<twoCellAnchor xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><from><col>2</col><colOff>9525</colOff><row>3</row><rowOff>0</rowOff></from><to><col>4</col><colOff>9525</colOff><row>5</row><rowOff>0</rowOff></to></twoCellAnchor>')
        sheet=fromstring('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultColWidth="10.7109375" defaultRowHeight="15"/></worksheet>')
        self.assertEqual(anchor_bounds(anchor,sheet),(161,60,160,40))
