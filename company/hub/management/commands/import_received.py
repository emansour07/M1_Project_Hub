"""Import expectations without writing to the source workbook."""
import time
from openpyxl import load_workbook
from django.core.management.base import BaseCommand,CommandError
from hub.models import Snapshot
from hub.received import read,asset,validate

class Command(BaseCommand):
    help='Read M1_Models_Received.xlsx and import scoped original-model expectations; never modifies Excel.'
    def add_arguments(self,parser):
        parser.add_argument('workbook')
        parser.add_argument('--scope-reviewed',action='store_true',help='Owner confirms the entire workbook is in scope; retain unresolved asset assignments separately.')
    def handle(self,*args,**options):
        knowledge=read('knowledge',{});scope=knowledge.get('scope',{}).get('rows',[])
        if not scope:raise CommandError('Synchronize the approved scope before importing the receipt workbook.')
        book=load_workbook(options['workbook'],read_only=True,data_only=True)
        try:
            sheet=book['Models'];header=list(next(sheet.iter_rows(min_row=5,max_row=5,values_only=True)))
            if header[:4]!=['Model code','Description','Source','Status']:raise CommandError('The Models worksheet headers changed; inspect the workbook before importing.')
            rule=next((f for f in knowledge.get('mapping',{}).get('naming',{}).get('fields',[]) if f['index']==5),{})
            labels={v['code']:v['description'].replace('BIM Model / ','') for v in rule.get('values',[])};rows=[]
            for number,values in enumerate(sheet.iter_rows(min_row=6,values_only=True),6):
                c=[str(v).strip() if v is not None else '' for v in values]+['']*14
                if not c[0].startswith('M1-'):continue
                row={'id':'received-'+str(number),'name':c[0],'description':c[1],'source':c[2],'revision':c[5],'discipline':labels.get(c[0].split('-')[5],'Unclassified')}
                match=asset(row,scope)
                if not match and not options['scope_reviewed']:continue
                row['scopeId']=match['id'] if match else 'pending';row['assetAssignmentPending']=not bool(match);row['formats']={f:{'sourceAvailable':False,'workbookReceived':c[6+2*i]=='Yes'} for i,f in enumerate(['native','nwc','ifc','dwfx'])};rows.append(row)
            data=validate({'sourceCheckedAt':int(time.time()*1000),'rows':rows,'scopeReviewed':options['scope_reviewed']},scope)
            Snapshot.objects.update_or_create(key='received-input',defaults={'data':data})
            self.stdout.write(f"Imported {len(data['rows'])} scoped entries. Excel unchanged. Run sync_m1 to reconcile ACC files.")
        finally:book.close()
