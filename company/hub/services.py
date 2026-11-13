from datetime import timedelta
from zoneinfo import ZoneInfo
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.core.mail import EmailMessage
from .models import AccessRequest, AccessProfile, AuditEvent, Outbox, ReminderSettings
from .aps import APS

def audit(actor, action, obj, **detail):
    AuditEvent.objects.create(actor=actor, action=action, object_id=str(obj), detail=detail)

def queue_request_notification(row):
    if not settings.M1_NOTIFICATION_EMAIL or not settings.DEFAULT_FROM_EMAIL: return False
    url = settings.PUBLIC_URL+'/owner/access/'+str(row.id)+'/'
    Outbox.objects.get_or_create(key='access:'+str(row.id), defaults={'recipient':settings.M1_NOTIFICATION_EMAIL,
        'sender':settings.DEFAULT_FROM_EMAIL,'subject':'M1 Forma access request — '+row.full_name,
        'body':f'{row.full_name}\n{row.email}\nCompany: {row.company}\nRole: {row.requested_role}\nDiscipline: {row.discipline}\n\nReview and approve after signing in:\n{url}\n\nOpening this link does not approve the request.'})
    return True

def sync_roles(client=None):
    # Project-user roles are supported with M1-only access; no hub-admin role catalogue is requested.
    client = client or APS(('account:read',))
    roles = {}
    for user in client.members():
        for role in user.get('roles', []):
            if role.get('id') and role.get('name'): roles[role['id']] = role['name']
    with transaction.atomic():
        for ident, name in roles.items():
            AccessProfile.objects.update_or_create(role_id=ident, defaults={'name':name,'active':True,
                'permission_summary':'M1 Docs member. Existing ACC folder permissions assigned to this project role apply.'})
        AccessProfile.objects.exclude(role_id__in=roles).update(active=False)
    return len(roles)

def decide_access(request_id, owner, approve):
    with transaction.atomic():
        row = AccessRequest.objects.select_for_update().select_related('profile').get(pk=request_id)
        if row.status != 'pending': raise ValueError('This request has already been reviewed.')
        if approve and (not row.profile or not row.profile.active): raise ValueError('The selected project role is no longer available. Ask the joiner to submit an updated request.')
        row.status = 'approved' if approve else 'rejected'
        row.decided_by = owner
        row.decided_at = timezone.now()
        row.save()
        audit(owner, row.status, row.id, role=row.profile.role_id if row.profile else None)
    return row

def provision(request_id, client=None):
    if not settings.M1_PROVISION_ENABLED: return False
    # Conditional claim prevents concurrent workers or repeated owner clicks from inviting twice.
    if not AccessRequest.objects.filter(pk=request_id,status='approved').update(status='provisioning'): return False
    row = AccessRequest.objects.select_related('profile').get(pk=request_id)
    try:
        if not row.profile or not row.profile.active: raise ValueError('The selected ACC role is no longer active.')
        client = client or APS(('account:read','account:write'))
        existing = next((u for u in client.members() if u.get('email','').casefold() == row.email.casefold()), None)
        if existing:
            row.status = 'already_member'
            row.acc_user_id = existing['id']
            row.detail = 'Already in M1. Existing roles and permissions were preserved; review in ACC if a role change is required.'
        else:
            result = client.add_member(row.email,row.profile)
            if not result.get('id'): raise ValueError('Autodesk did not return a membership ID. Verify the result in ACC.')
            row.status = 'provisioned'
            row.acc_user_id = result['id']
            row.detail = 'Added to M1 with the approved project role and Docs member access.'
    except Exception:
        row.status = 'needs_attention'
        row.detail = 'Membership could not be confirmed. Check ACC and the server connection before retrying. Automatic retries are stopped to avoid duplicate invitations.'
    row.save(update_fields=['status','acc_user_id','detail'])
    audit('scheduler','access.'+row.status,row.id)
    return row.status in ('provisioned','already_member')

def queue_reminders(now=None):
    now = (now or timezone.now()).astimezone(ZoneInfo('Asia/Dubai'))
    config = ReminderSettings.objects.first()
    if not config or config.paused or now.weekday()!=2 or now.hour<14: return 0
    config.full_clean()
    count = 0
    for email in config.recipient_list():
        _, created = Outbox.objects.get_or_create(key=f'weekly:{now.date()}:{email}',defaults={
            'recipient':email,'sender':config.sender,'subject':config.subject,
            'body':config.message+'\n\n'+settings.PUBLIC_URL+'/#duties'})
        count += created
    return count

def send_outbox():
    if not settings.M1_MAIL_ENABLED: return 0
    count = 0
    for ident in Outbox.objects.filter(state='pending').values_list('id',flat=True)[:200]:
        row = Outbox.objects.get(pk=ident)
        if row.key.startswith('weekly:'):
            config = ReminderSettings.objects.first()
            today = timezone.localdate(timezone=ZoneInfo('Asia/Dubai')).isoformat()
            if not config or config.paused or row.key.split(':')[1]!=today or row.recipient not in config.recipient_list():
                Outbox.objects.filter(pk=ident,state='pending').update(state='cancelled')
                continue
        if not row.sender.lower().endswith('@arx.ing'): continue
        if not Outbox.objects.filter(pk=ident,state='pending').update(state='sending'): continue
        try:
            sent = EmailMessage(row.subject,row.body,row.sender,[row.recipient]).send(fail_silently=False)
            if sent != 1: raise RuntimeError('Email was not accepted.')
            Outbox.objects.filter(pk=ident).update(state='sent',sent_at=timezone.now())
            count += 1
        except Exception:
            Outbox.objects.filter(pk=ident).update(state='failed',error='Mail delivery was not confirmed. Check mailbox logs before retrying.')
    return count
