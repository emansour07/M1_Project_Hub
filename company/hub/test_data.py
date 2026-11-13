import io
import zipfile
from types import SimpleNamespace
from unittest.mock import Mock
from django.test import SimpleTestCase,TestCase
from openpyxl import Workbook,load_workbook
from .workbooks import midp_entries,scoped
from .exports import export_midp
from .completeness import calculate
from .sync import shared_checks,grouped_models,check_name,model
from .tracker import DraftForm,patch_workbook

SCOPE=[{'id':'Island-A48','code':'A48','proposed':'CRA','name':'Gatehouse','zone':'Island','aliases':['A48','CRA'],'ambiguous':[]}]
NAME='M1-FXX-SAP-CRA-05-BM012-BNM-ZZ-000001'
MAPPING=[{'existing':'A48','proposed':'CRA','section':'10.2'}]
RULES={'fields':[{'index':1,'label':'Parcel','values':[{'code':'FXX'}]}],'pattern':'Project-Parcel-Originator-Asset-Stage-Package-Type-Level-Number[-Revision]'}

def workbook():
    w=Workbook();s=w.active;s.title='102-ARX-A48'
    header=['DELIVERABLE (TITLE)','DESCRIPTION','.rvt','.nwc']+['']*14+['Project Stage']+['']*8+['Issue Date','Author','Transmittal Number','Planned','Forecast','MACE_ACC_Status']
    s.append(header);s.append(['BIM Models'])
    for number,planned,status in [('000001','2026-11-18','approved'),('000002','2026-11-25','rejected')]:
        row=[NAME.replace('000001',number),'Test','yes','yes']+['']*14+['05']+['']*8+['2026-10-01','','',planned,'2026-11-26',status]
        s.append(row)
    s['A3'].font=s['A3'].font.copy(bold=True);s.column_dimensions['A'].width=70
    output=io.BytesIO();w.save(output);return output.getvalue()

class WorkbookTests(SimpleTestCase):
    def test_named_planned_forecast_approval_stage(self):
        rows=midp_entries(workbook(),SCOPE)
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['plannedDate'],'2026-11-18')
        self.assertEqual(rows[0]['forecastDate'],'2026-11-26');self.assertEqual(rows[0]['approvalStatus'],'approved')
        self.assertEqual(rows[0]['projectStage'],'05');self.assertEqual(rows[0]['latestIssueDate'],'2026-10-01')
    def test_export_filters_planned_not_issue_date_and_preserves_styles(self):
        raw=workbook();rows=midp_entries(raw,SCOPE)
        filtered=export_midp(raw,rows,'2026-11-18','2026-11-18')
        w=load_workbook(io.BytesIO(filtered));s=w.active
        self.assertEqual(s['A3'].value,NAME);self.assertIsNone(s['A4'].value)
        self.assertTrue(s['A3'].font.bold);self.assertEqual(s.column_dimensions['A'].width,70)
        with zipfile.ZipFile(io.BytesIO(raw)) as before,zipfile.ZipFile(io.BytesIO(filtered)) as after:self.assertEqual(before.read('xl/styles.xml'),after.read('xl/styles.xml'))
        with self.assertRaises(ValueError):export_midp(raw,rows,'2026-10-01','2026-10-01')
    def test_missing_planned_does_not_fall_back_to_issue(self):
        w=load_workbook(io.BytesIO(workbook()));w.active['AE1']='Not planned';o=io.BytesIO();w.save(o)
        rows=midp_entries(o.getvalue(),SCOPE);self.assertIsNone(rows[0]['plannedDate'])
    def test_out_of_scope_is_not_retained(self):
        self.assertIsNone(scoped({'name':NAME.replace('CRA','XYZ'),'folderPath':['A48']},SCOPE))
    def test_ambiguous_legacy_asset_does_not_guess(self):
        scope=[{**SCOPE[0],'ambiguous':['A48']},{**SCOPE[0],'id':'Mainland-A48','proposed':'GS5','zone':'Mainland','aliases':['A48','GS5'],'ambiguous':['A48']}]
        self.assertIsNone(scoped({'name':NAME.replace('CRA','A48')},scope))

class CompletenessTests(SimpleTestCase):
    def policy(self):return SimpleNamespace(enabled=True,denominator_confirmed=True,approved_statuses='approved\napproved w/ comments')
    def test_blank_rejected_and_resubmit_remain_in_denominator(self):
        rows=[{'scopeId':'a','name':str(i),'approvalStatus':status,'category':'Models'} for i,status in enumerate(['approved','approved w/ comments','revise and resubmit','rejected',''])]
        score=calculate(rows,self.policy())['a'];self.assertEqual(score['total'],5);self.assertEqual(score['approved'],2);self.assertEqual(score['percentage'],40);self.assertEqual(score['blankStatus'],1)
    def test_each_asset_is_independent_and_status_match_is_exact(self):
        result=calculate([{'scopeId':'a','name':'1','approvalStatus':'not approved'},{'scopeId':'b','name':'1','approvalStatus':' APPROVED '}],self.policy())
        self.assertEqual(result['a']['percentage'],0);self.assertEqual(result['b']['percentage'],100)
    def test_duplicate_conflicting_status_is_not_approved_or_double_counted(self):
        rows=[{'scopeId':'a','name':'one','approvalStatus':'approved'},{'scopeId':'a','name':'ONE','approvalStatus':'rejected'}]
        score=calculate(rows,self.policy())['a'];self.assertEqual(score['total'],1);self.assertEqual(score['approved'],0);self.assertEqual(score['conflictingStatus'],1)
    def test_no_confirmed_policy_means_not_scored(self):
        score=calculate([{'scopeId':'a','name':'one','approvalStatus':'approved'}],None)['a'];self.assertIsNone(score['percentage'])
    def test_model_formats_do_not_multiply_completeness_denominator(self):
        rows=[{'scopeId':'a','name':'same.'+ext,'approvalStatus':'approved','category':'Models'} for ext in ['rvt','nwc','ifc','dwfx']]
        score=calculate(rows,self.policy())['a'];self.assertEqual(score['total'],1);self.assertEqual(score['percentage'],100)

class CheckerTests(SimpleTestCase):
    def f(self,extension,**kw):return {'name':NAME+'.'+extension,'source':'progress1','folderId':'a','folderPath':[],'scopeId':'Island-A48','scopeName':'Gatehouse','descriptionRead':True,'description':'Model','version':1,'updatedAt':'2026-11-13T00:00:00Z',**kw}
    def test_pair_is_required_in_same_folder(self):
        rows=shared_checks([self.f('rvt'),self.f('nwc',folderId='b')],MAPPING,RULES)
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['missing'],['nwc'])
    def test_missing_metadata_does_not_pass(self):
        rows=shared_checks([self.f('rvt',descriptionRead=False,version=None),self.f('nwc')],MAPPING,RULES)
        self.assertEqual(rows[0]['state'],'Not fully checked')
    def test_versions_and_descriptions_highlighted(self):
        rows=shared_checks([self.f('rvt',description=''),self.f('nwc',version=2)],MAPPING,RULES)
        self.assertTrue(rows[0]['versionMismatch']);self.assertIn('Missing description',rows[0]['issues'])
    def test_one_model_multiple_formats_keeps_old_native_date(self):
        grouped=grouped_models([self.f('rvt',updatedAt='2026-11-01T00:00:00Z'),self.f('nwc'),self.f('ifc')])
        self.assertEqual(len(grouped),1);self.assertEqual(grouped[0]['updatedAt'],'2026-11-01T00:00:00Z')
    def test_review_needs_four_formats(self):
        row=grouped_models([self.f('rvt',source='review'),self.f('nwc',source='review')])[0]
        self.assertEqual(row['locations'][0]['missing'],['ifc','dwfx'])
    def test_pdf_and_landscape_cad_do_not_become_models(self):
        self.assertFalse(model(self.f('pdf')));self.assertFalse(model(self.f('dwg',name=NAME.replace('BM012','BM032')+'.dwg')))
    def test_naming_corrects_only_unambiguous_fields(self):
        result=check_name(NAME.replace('FXX','102').replace('CRA','A48')+'.rvt',MAPPING,RULES)
        self.assertEqual(result['suggestion'],NAME+'.rvt')

class DraftTests(SimpleTestCase):
    def test_editor_form_omits_protected_and_unassigned_fields(self):
        user={'owner':False,'assets':['a'],'disciplines':['Structure'],'fields':['progress']}
        row={'scopeId':'a','discipline':'Structure','fields':{}}
        columns=[{'key':'name','label':'Name','type':'text'},{'key':'progress','label':'LOG %','type':'percent'},{'key':'other','label':'Other','type':'text'}]
        form=DraftForm(user,row,columns,{'progress':'101','name':'changed','other':'x'})
        self.assertEqual(list(form.fields),['progress']);self.assertFalse(form.is_valid())
    def test_tracker_patch_preserves_unrelated_parts_and_writes_literal_text(self):
        w=Workbook();s=w.active;s.title='Tracker';s.append(['Name','LOG %','Notes']);s.append([NAME,.25,'Old']);o=io.BytesIO();w.save(o)
        raw=o.getvalue();draft=SimpleNamespace(model_name=NAME,changes={'C':'=HYPERLINK("bad")'})
        columns=[{'key':'A','label':'Name','type':'text','excelColumn':'A'},{'key':'B','label':'LOG %','type':'percent','excelColumn':'B'},{'key':'C','label':'Notes','type':'text','excelColumn':'C'}, {'key':'lastUpdate','label':'Last team update','type':'date'}]
        output=patch_workbook(raw,draft,{'missingFromTracker':False},columns)
        changed=load_workbook(io.BytesIO(output));self.assertEqual(changed.active['C2'].value,'=HYPERLINK("bad")');self.assertEqual(changed.active['C2'].data_type,'s')
        with zipfile.ZipFile(io.BytesIO(raw)) as before,zipfile.ZipFile(io.BytesIO(output)) as after:self.assertEqual(before.read('xl/styles.xml'),after.read('xl/styles.xml'))
