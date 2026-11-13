from django.contrib import admin, messages
from django.utils.html import format_html
from django.core.exceptions import ValidationError
from .models import *
from .aps import APS
from .services import sync_roles
from .forms import EditorForm, MasterplanForm, DestinationForm

admin.site.site_header = 'ARX · M1 owner workspace'
admin.site.site_title = 'M1 owner workspace'

class LinkInline(admin.TabularInline):
    model = ContentLink
    extra = 1
@admin.register(ContentSection)
class ContentAdmin(admin.ModelAdmin):
    list_display = ['title','area','order']
    list_filter = ['area']
    inlines = [LinkInline]

@admin.register(Editor)
class EditorAdmin(admin.ModelAdmin):
    form = EditorForm
    list_display = ['email','active']
    search_fields = ['email']

@admin.register(ReminderSettings)
class ReminderAdmin(admin.ModelAdmin):
    def has_add_permission(self,request): return not ReminderSettings.objects.exists() and super().has_add_permission(request)

@admin.register(AccessRequest)
class AccessAdmin(admin.ModelAdmin):
    list_display = ['full_name','email','requested_role','company','status','created_at','review']
    list_filter = ['status','discipline']
    search_fields = ['email','full_name','company']
    readonly_fields = [f.name for f in AccessRequest._meta.fields]
    def has_add_permission(self,request): return False
    def has_delete_permission(self,request,obj=None): return False
    def review(self,obj): return format_html('<a href="/owner/access/{}/">Review request</a>',obj.id)

@admin.register(AccessProfile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ['name','role_id','active']
    readonly_fields = ['name','role_id','permission_summary']
    actions = ['refresh_roles']
    def has_add_permission(self,request): return False
    @admin.action(description='Refresh actual roles used by M1 project members')
    def refresh_roles(self,request,queryset):
        try: self.message_user(request,f'{sync_roles()} project roles refreshed.')
        except Exception: self.message_user(request,'Role refresh failed. Check the company Autodesk connection.',messages.ERROR)

@admin.register(UploadDestination)
class DestinationAdmin(admin.ModelAdmin):
    form = DestinationForm
    list_display = ['asset_name','discipline','folder_path','verified','active']
    list_filter = ['root','discipline','active']
    readonly_fields = ['verified']

class HotspotInline(admin.TabularInline):
    model = AssetHotspot
    extra = 0

@admin.register(Masterplan)
class MasterplanAdmin(admin.ModelAdmin):
    form = MasterplanForm
    list_display = ['zone','title','approved','place_assets']
    inlines = [HotspotInline]
    def place_assets(self,obj): return format_html('<a href="/owner/masterplan/{}/">Place assets on plan</a>',obj.id)

@admin.register(AuditEvent,Outbox,UploadIntent,TrackerDraft,SyncJob)
class ReadOnlyAdmin(admin.ModelAdmin):
    def get_readonly_fields(self,request,obj=None): return [f.name for f in self.model._meta.fields]
    def has_add_permission(self,request): return False
    def has_delete_permission(self,request,obj=None): return False

@admin.register(CompletenessPolicy)
class CompletenessAdmin(admin.ModelAdmin):
    def has_add_permission(self,request):return not CompletenessPolicy.objects.exists() and super().has_add_permission(request)
