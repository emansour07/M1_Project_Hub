import io
from datetime import date
from django.test import TestCase
from openpyxl import Workbook, load_workbook
from .tidps import extract_source, merge_sources, export_merged
from .models import Snapshot

class TidpTests(TestCase):
    def setUp(self):
        self.scope=[{'id':'Island-A','code':'A','name':'Asset A','zone':'Island','proposed':'A','aliases':['A'],'ambiguous':[],'filename':'M1-FXX-SAP-A-05-LD000-LOD-XX-000001_TIDP_A.xlsx'}]
    def record(self,ident='a',approval='approved'):
        w=Workbook();s=w.active;s.title='ARCH'
        for c,v in {1:'DELIVERABLE (TITLE)',2:'DESCRIPTION',28:'Issue Date',55:'Planned Date',56:'Forecast Date',57:'MACE_ACC_Status'}.items():s.cell(1,c,v)
        s.cell(2,3,'.rvt');s.cell(3,1,'BIM Models')
        for c,v in {1:'M1-FXX-SAP-A-05-BM010-BNM-XX-000001-R00',2:'Model',3:'Yes',18:'A',55:date(2026,11,16),56:date(2026,11,18),57:approval}.items():s.cell(4,c,v)
        s.cell(5,1,'M1-FXX-SAP-OTHER-05-BM010-BNM-XX-000001-R00');s.cell(5,2,'Outside scope')
        output=io.BytesIO();w.save(output)
        return extract_source(output.getvalue(),{'name':self.scope[0]['filename'],'itemId':ident,'version':1},self.scope)
    def test_merge_and_formatted_full_or_date_export(self):
        a=self.record();b=self.record('b');entries=merge_sources([a,b])
        self.assertEqual(len(entries),2);self.assertEqual(entries[0]['duplicateCount'],1)
        self.assertEqual(entries[0]['plannedDate'],'2026-11-16');self.assertEqual(entries[0]['forecastDate'],'2026-11-18')
        self.assertFalse(entries[0]['conflict'])
        Snapshot.objects.create(key='tidp:test:0',data=a);Snapshot.objects.create(key='tidp:test:1',data=b)
        snap={'generation':'test','recordCount':2,'entries':entries}
        for filters in [{},{'start':'2026-11-16','end':'2026-11-16'}]:
            out=export_merged(snap,filters);w=load_workbook(io.BytesIO(out),data_only=True)
            self.assertEqual(len(w.worksheets),6);self.assertEqual(w['Island-A']['BC10'].value,'approved');self.assertEqual(w['Island-A']['BD10'].value.date(),date(2026,11,16));self.assertEqual(w['Island-A']['A10'].value,w['Island-A']['A11'].value);self.assertEqual(w['Data'].max_row,3);self.assertEqual(w['Data'].sheet_state,'hidden');w.close()
        with self.assertRaises(ValueError):export_merged(snap,{'start':'2026-11-17','end':'2026-11-16'})
    def test_repeated_names_retain_each_rows_approval(self):
        entries=merge_sources([self.record(),self.record('b','rejected')])
        self.assertEqual(len(entries),2);self.assertTrue(entries[0]['conflict']);self.assertEqual([r['approvalStatus'] for r in entries],['approved','rejected'])

    def test_source_rename_clears_affected_rows(self):
        a=self.record();b=self.record('b')
        self.assertEqual(sum(bool(r['duplicateCount']) for r in merge_sources([a,b])),2)
        b['entries'][0]['name']=b['entries'][0]['name'].replace('000001','000002')
        rows=merge_sources([a,b]);self.assertEqual(len(rows),2);self.assertEqual(sum(bool(r['duplicateCount']) for r in rows),0)
