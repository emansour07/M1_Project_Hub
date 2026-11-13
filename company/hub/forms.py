from django import forms
from .models import AccessProfile, AccessRequest, Snapshot, Editor, Masterplan, UploadDestination

class AccessRequestForm(forms.ModelForm):
    profile = forms.ModelChoiceField(queryset=AccessProfile.objects.none(), label='Project role', empty_label='Select your M1 role')
    project = forms.CharField(initial='M1', disabled=True)
    website = forms.CharField(required=False, widget=forms.HiddenInput)
    class Meta:
        model = AccessRequest
        fields = ['full_name','email','company','project','profile','discipline']
        labels = {'full_name':'Full name','email':'Work email'}
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.fields['profile'].queryset = AccessProfile.objects.filter(active=True).order_by('name')
        s = Snapshot.objects.filter(key='tracker').first()
        disciplines = sorted({r.get('discipline','') for r in (s.data.get('rows',[]) if s else [])}-{''})
        self.fields['discipline'] = forms.ChoiceField(choices=[('','Select discipline')]+[(x,x) for x in disciplines])
    def clean_email(self): return self.cleaned_data['email'].strip().lower()
    def clean_website(self):
        if self.cleaned_data.get('website'): raise forms.ValidationError('Request could not be submitted.')
        return ''

class EditorForm(forms.ModelForm):
    assets=forms.MultipleChoiceField(widget=forms.CheckboxSelectMultiple)
    disciplines=forms.MultipleChoiceField(widget=forms.CheckboxSelectMultiple)
    fields=forms.MultipleChoiceField(widget=forms.CheckboxSelectMultiple)
    class Meta:
        model=Editor
        fields=['email','active','assets','disciplines','fields']
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        k=Snapshot.objects.filter(key='knowledge').first();t=Snapshot.objects.filter(key='tracker').first()
        assets=k.data.get('scope',{}).get('rows',[]) if k else [];tracker=t.data if t else {}
        self.fields['assets'].choices=[('*','All in-scope assets')]+[(a['id'],a['name']+' · '+a['code']) for a in assets]
        self.fields['disciplines'].choices=[('*','All disciplines')]+[(d,d) for d in sorted({r['discipline'] for r in tracker.get('rows',[])})]
        self.fields['fields'].choices=[('*','All editable fields')]+[(c['key'],(c.get('group','')+' · '+c['label']).strip(' ·')) for c in tracker.get('columns',[]) if not c.get('readonly') and c['label'].lower() not in ['#','name','parcel','description']]

class MasterplanForm(forms.ModelForm):
    class Meta:
        model=Masterplan
        fields='__all__'
    def clean_image(self):
        file=self.cleaned_data['image']
        if not getattr(file,'_committed',False):
            if file.size>20*1024*1024:raise forms.ValidationError('Use a PNG or JPEG smaller than 20 MB.')
            prefix=file.read(12);file.seek(0)
            png=prefix.startswith(b'\x89PNG\r\n\x1a\n') and file.name.lower().endswith('.png')
            jpg=prefix.startswith(b'\xff\xd8\xff') and file.name.lower().endswith(('.jpg','.jpeg'))
            if not (png or jpg):raise forms.ValidationError('Use a PNG or JPEG exported from the approved plan.')
        return file

class DestinationForm(forms.ModelForm):
    asset_id=forms.ChoiceField(label='Asset')
    discipline=forms.ChoiceField()
    class Meta:
        model=UploadDestination
        fields=['asset_id','discipline','root','folder_id','folder_path','active']
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        k=Snapshot.objects.filter(key='knowledge').first();t=Snapshot.objects.filter(key='tracker').first()
        self.assets=k.data.get('scope',{}).get('rows',[]) if k else []
        self.fields['asset_id'].choices=[(a['id'],a['name']+' · '+a['code']) for a in self.assets]
        self.fields['discipline'].choices=[(d,d) for d in sorted({r['discipline'] for r in (t.data.get('rows',[]) if t else [])})]
    def clean(self):
        data=super().clean()
        if data.get('folder_id') and data.get('root'):
            from .aps import APS
            try:APS().verify_destination(data['folder_id'],data['root'])
            except Exception:raise forms.ValidationError('The folder could not be verified inside the selected M1 Shared root.')
        return data
    def save(self,commit=True):
        obj=super().save(commit=False)
        obj.asset_name=next(a['name'] for a in self.assets if a['id']==obj.asset_id)
        obj.verified=True
        if commit:obj.save()
        return obj
