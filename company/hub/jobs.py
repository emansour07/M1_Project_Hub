from datetime import timedelta
from django.conf import settings
from django.utils import timezone
from .models import SyncJob
from .sync import synchronize

def queue_sync():
    job,created=SyncJob.objects.get_or_create(key='project')
    if not created and job.state not in ['queued','running']:
        if job.finished_at and job.finished_at>timezone.now()-timedelta(minutes=1):return False
        SyncJob.objects.filter(pk='project',state=job.state).update(state='queued',requested_at=timezone.now())
    return True

def run_sync():
    if not settings.APS_CONFIG.get('APS_SSA_PRIVATE_KEY_PATH'):return False
    # A single process owns a read-only refresh; other scheduler invocations exit.
    job=SyncJob.objects.filter(pk='project').first()
    if not job or job.state not in ['queued','running'] and (not job.finished_at or job.finished_at<timezone.now()-timedelta(minutes=5)):
        queue_sync()
    if not SyncJob.objects.filter(pk='project',state='queued').update(state='running',started_at=timezone.now(),error=''):return False
    try:
        result=synchronize()
        SyncJob.objects.filter(pk='project').update(state='complete',finished_at=timezone.now())
        return result
    except Exception:
        SyncJob.objects.filter(pk='project').update(state='failed',finished_at=timezone.now(),error='The project refresh failed. The last complete dataset was retained. Check Autodesk access and workbook layouts.')
        return False
