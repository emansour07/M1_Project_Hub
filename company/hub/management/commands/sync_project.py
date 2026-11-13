from django.core.management.base import BaseCommand
from hub.jobs import queue_sync, run_sync
class Command(BaseCommand):
    help = 'Queue and run a complete M1 project synchronization.'
    def handle(self,*args,**options):
        queue_sync()
        self.stdout.write(str(run_sync()))
