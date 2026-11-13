import uuid
from django.db import models
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

class Snapshot(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

class Requirement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    revision = models.PositiveIntegerField(default=1)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.EmailField()
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.EmailField()

class RequirementEvent(models.Model):
    requirement = models.ForeignKey(Requirement, on_delete=models.PROTECT, related_name='events')
    data = models.JSONField(default=dict)

class Editor(models.Model):
    email = models.EmailField(unique=True)
    active = models.BooleanField(default=True)
    assets = models.JSONField(default=list, help_text='Asset IDs allowed for this editor; ["*"] means all.')
    disciplines = models.JSONField(default=list, help_text='Allowed discipline labels; ["*"] means all.')
    fields = models.JSONField(default=list, help_text='Editable tracker column keys.')
    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        super().save(*args, **kwargs)
    def __str__(self): return self.email

class ContentSection(models.Model):
    area = models.CharField(max_length=20, choices=[('duties', 'Duties'), ('guidance', 'Submission and review procedures'), ('project', 'Project information')])
    title = models.CharField(max_length=180)
    body = models.TextField()
    order = models.PositiveIntegerField(default=0)
    class Meta: ordering = ['order', 'id']
    def __str__(self): return self.title

class ContentLink(models.Model):
    section = models.ForeignKey(ContentSection, on_delete=models.CASCADE, related_name='links')
    label = models.CharField(max_length=120)
    url = models.URLField(max_length=2000)
    def clean(self):
        if not self.url.startswith('https://'): raise ValidationError('Links must use HTTPS.')

class ReminderSettings(models.Model):
    paused = models.BooleanField(default=True)
    sender = models.EmailField(blank=True)
    recipients = models.TextField(blank=True, help_text='One email address per line. Wednesday 14:00 Asia/Dubai.')
    subject = models.CharField(max_length=180, default='M1 — weekly Shared model update')
    message = models.TextField(default='Please update your Shared models, including native and NWC formats, descriptions and matching versions. Open Weekly sharing in the M1 Project Hub.')
    def clean(self):
        if self.sender and self.sender.rsplit('@', 1)[-1].lower() != 'arx.ing': raise ValidationError('Use an arx.ing sender mailbox.')
        for email in self.recipient_list(): validate_email(email)
        if len(self.recipient_list()) > 200: raise ValidationError('Maximum 200 recipients.')
        if not self.paused and (not self.sender or not self.recipient_list()): raise ValidationError('Add a sender and recipients before resuming.')
    def recipient_list(self): return sorted(set(x.strip().lower() for x in self.recipients.splitlines() if x.strip()))
    def __str__(self): return 'Wednesday 2 PM Dubai reminder'

class Outbox(models.Model):
    key = models.CharField(max_length=180, unique=True)
    recipient = models.EmailField()
    subject = models.CharField(max_length=180)
    body = models.TextField()
    sender = models.EmailField()
    state = models.CharField(max_length=20, default='pending', choices=[(x,x) for x in ['pending','sending','sent','failed','cancelled']])
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)

class AccessProfile(models.Model):
    name = models.CharField(max_length=120)
    role_id = models.CharField(max_length=160, unique=True, help_text='Verified M1 ACC role ID. Its existing folder permissions will apply.')
    company_id = models.CharField(max_length=160, blank=True, help_text='Verified Autodesk company ID, if applicable.')
    discipline = models.CharField(max_length=100)
    permission_summary = models.TextField(help_text='Describe the existing ACC role folder permissions for the owner approval screen.')
    active = models.BooleanField(default=False, help_text='Enable only after checking the role and inherited folder permissions in ACC.')
    def __str__(self): return self.name

class AccessRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    full_name = models.CharField(max_length=180)
    email = models.EmailField()
    company = models.CharField(max_length=180)
    requested_role = models.CharField(max_length=120)
    discipline = models.CharField(max_length=100)
    status = models.CharField(max_length=24, default='pending', choices=[(x,x) for x in ['pending','approved','provisioning','provisioned','already_member','rejected','needs_attention']])
    profile = models.ForeignKey(AccessProfile, null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.EmailField(blank=True)
    acc_user_id = models.CharField(max_length=160, blank=True)
    detail = models.TextField(blank=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['email'],condition=models.Q(status__in=['pending','approved','provisioning']),name='one_active_access_request_per_email')]
    def __str__(self): return f'{self.full_name} · {self.email}'

class AuditEvent(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    actor = models.CharField(max_length=254)
    action = models.CharField(max_length=100)
    object_id = models.CharField(max_length=180)
    detail = models.JSONField(default=dict)

class UploadDestination(models.Model):
    asset_id = models.CharField(max_length=160)
    asset_name = models.CharField(max_length=180)
    discipline = models.CharField(max_length=100)
    folder_id = models.CharField(max_length=240, unique=True)
    folder_path = models.CharField(max_length=600)
    root = models.CharField(max_length=20, choices=[('progress1','Shared 1'),('progress2','Shared 2')])
    verified = models.BooleanField(default=False, editable=False)
    active = models.BooleanField(default=True)
    def __str__(self): return f'{self.asset_name} · {self.discipline} · {self.folder_path}'

class UploadIntent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    editor_email = models.EmailField()
    destination = models.ForeignKey(UploadDestination, on_delete=models.PROTECT)
    filename = models.CharField(max_length=255)
    expected_version = models.CharField(max_length=255, blank=True)
    item_id = models.CharField(max_length=255, blank=True)
    state = models.CharField(max_length=30, default='preview')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

class Masterplan(models.Model):
    zone = models.CharField(max_length=20, unique=True, choices=[('Island','Island'),('Mainland','Mainland')])
    title = models.CharField(max_length=180)
    image = models.FileField(upload_to='masterplans/', help_text='PNG or JPEG exported from the approved plan. Prefer highlighted Revit-derived buildings where sources differ.')
    source_url = models.URLField(max_length=2000)
    approved = models.BooleanField(default=False)
    def __str__(self): return self.zone

class AssetHotspot(models.Model):
    plan = models.ForeignKey(Masterplan, on_delete=models.CASCADE, related_name='hotspots')
    asset_id = models.CharField(max_length=160)
    name = models.CharField(max_length=180)
    code = models.CharField(max_length=80)
    x = models.FloatField(help_text='Horizontal position 0–100 percent')
    y = models.FloatField(help_text='Vertical position 0–100 percent')
    function = models.TextField(blank=True)
    width = models.FloatField(default=5, help_text='Building width as a percentage of plan width')
    height = models.FloatField(default=4, help_text='Building height as a percentage of plan height')
    class Meta:
        constraints=[models.UniqueConstraint(fields=['plan','asset_id'],name='one_asset_position_per_plan')]
    def clean(self):
        if not 0 <= self.x <= 100 or not 0 <= self.y <= 100: raise ValidationError('Positions must be between 0 and 100.')
        if not 0 < self.width <= 100 or not 0 < self.height <= 100: raise ValidationError('Building dimensions must be between 0 and 100 percent.')

class TrackerDraft(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    editor = models.EmailField()
    row_id = models.CharField(max_length=200)
    source_version = models.CharField(max_length=255)
    changes = models.JSONField(default=dict)
    model_name = models.CharField(max_length=255, blank=True)
    scope_id = models.CharField(max_length=160, blank=True)
    approved_by = models.EmailField(blank=True)
    published_version = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

class RateBucket(models.Model):
    key = models.CharField(max_length=100, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()

class SyncJob(models.Model):
    key = models.CharField(max_length=40, primary_key=True, default='project')
    state = models.CharField(max_length=20, default='queued')
    requested_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    error = models.TextField(blank=True)

class CompletenessPolicy(models.Model):
    enabled = models.BooleanField(default=False)
    approved_statuses = models.TextField(blank=True, help_text='Exact approved MACE_ACC_Status values, one per line. No partial status matching.')
    denominator_confirmed = models.BooleanField(default=False, help_text='Approved documents divided by total documents per asset.')
    def clean(self):
        if self.enabled and (not self.denominator_confirmed or not self.approved_statuses.strip()): raise ValidationError('Confirm the denominator and approved status values before enabling scoring.')
    def __str__(self): return 'MIDP approval and completeness rules'
