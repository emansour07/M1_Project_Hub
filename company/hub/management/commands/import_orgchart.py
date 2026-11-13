from django.core.management.base import BaseCommand
from django.conf import settings
from hub.orgchart import render_orgchart
from hub.models import Snapshot

class Command(BaseCommand):
    help = 'Render the supplied organisation-chart workbook without inferring its hierarchy.'
    def add_arguments(self,parser): parser.add_argument('workbook')
    def handle(self,*args,**options):
        svg,names = render_orgchart(options['workbook'])
        settings.MEDIA_ROOT.mkdir(parents=True,exist_ok=True)
        (settings.MEDIA_ROOT/'orgchart.svg').write_text(svg,encoding='utf8')
        Snapshot.objects.update_or_create(key='orgchart',defaults={'data':{'labels':names,'source':'261101_M1_PkgF_OrgChart_&_RACI.xlsx'}})
        self.stdout.write(f'Imported {len(names)} organisation-chart text boxes.')
