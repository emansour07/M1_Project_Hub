from django.core.management.base import BaseCommand, CommandError
from hub.assurance import sync_issues
from hub.aps import ProviderError

class Command(BaseCommand):
    help='Read M1 ACC Issues into the dashboard; never creates or modifies Autodesk issues.'
    def handle(self,*args,**options):
        try:self.stdout.write(str(sync_issues()))
        except (ValueError,ProviderError) as exc:raise CommandError(str(exc))
