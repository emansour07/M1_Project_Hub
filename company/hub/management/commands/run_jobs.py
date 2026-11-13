from django.core.management.base import BaseCommand
from hub.models import AccessRequest, RateBucket
from hub.services import queue_reminders, send_outbox, provision, queue_request_notification
from django.utils import timezone
from hub.jobs import run_sync

class Command(BaseCommand):
    help = 'Run once per minute using the company scheduler. Sends due reminders and approved membership requests.'
    def handle(self,*args,**options):
        RateBucket.objects.filter(expires_at__lt=timezone.now()).delete()
        for row in AccessRequest.objects.filter(status='pending'): queue_request_notification(row)
        queued = queue_reminders()
        sent = send_outbox()
        approved = list(AccessRequest.objects.filter(status='approved').values_list('id',flat=True)[:20])
        provisioned = sum(provision(ident) for ident in approved)
        refreshed = run_sync()
        self.stdout.write(f'Reminders queued: {queued}; mail sent: {sent}; memberships confirmed: {provisioned}')
        self.stdout.write('Project refresh completed.' if refreshed else 'No project refresh completed in this run.')
