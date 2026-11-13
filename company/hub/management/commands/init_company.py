from django.core.management.base import BaseCommand
from hub.models import ReminderSettings,CompletenessPolicy,ContentSection,ContentLink
from hub.aps import ROOTS
from django.conf import settings
from urllib.parse import urlencode

class Command(BaseCommand):
    help = 'Initialize owner-editable M1 settings without credentials, emails or live writes.'
    def handle(self,*args,**options):
        ReminderSettings.objects.get_or_create(pk=1,defaults={'paused':True})
        CompletenessPolicy.objects.get_or_create(pk=1,defaults={'enabled':True,'denominator_confirmed':True,
            'approved_statuses':'approved\napproved w/ comments'})
        section,_=ContentSection.objects.get_or_create(title='Weekly Shared model update',defaults={'area':'duties','order':10,
            'body':'Update the assigned Shared folder each week. Each model needs its native RVT or Civil 3D DWG and NWC in the same subfolder. Add descriptions, check naming, and keep counterpart ACC versions aligned. The weekly reminder is Wednesday at 2 PM Dubai time.'})
        for key,folder in ROOTS.items():
            ContentLink.objects.get_or_create(section=section,label='Shared folder '+key[-1],defaults={'url':'https://acc.autodesk.eu/docs/files/projects/'+settings.M1_PROJECT_ID+'?'+urlencode({'folderUrn':folder,'viewModel':'detail','moduleId':'folders'})})
        ContentSection.objects.get_or_create(title='Review submission components',defaults={'area':'guidance','order':20,
            'body':'Models in the 4.0 Review folder require native RVT or Civil 3D DWG, NWC, IFC and DWFX. The project owner will add the agreed submission steps and review responsibilities here.'})
        self.stdout.write('Initialized M1 content and paused reminders. No messages or invitations sent.')
