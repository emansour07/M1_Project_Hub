import base64
import hashlib
import json
import secrets
import time
import urllib.parse
from django.conf import settings
from django.http import HttpResponseForbidden
from django.shortcuts import redirect
from .aps import request
from .models import Editor

def identity(req):
    if req.user.is_authenticated and req.user.is_superuser:
        return {'owner':True,'email':req.user.email,'assets':['*'],'disciplines':['*'],'fields':['*']}
    email = req.session.get('editor_email')
    if not email or req.session.get('editor_until',0) < time.time(): return None
    row = Editor.objects.filter(email=email,active=True).first()
    return {'owner':False,'email':row.email,'assets':row.assets,'disciplines':row.disciplines,'fields':row.fields} if row else None

def allowed(user, asset, discipline):
    return bool(user and (user['owner'] or (('*' in user['assets'] or asset in user['assets']) and ('*' in user['disciplines'] or discipline in user['disciplines']))))

def editor_login(req):
    c = settings.APS_CONFIG
    if not c['M1_LOGIN_CLIENT_ID'] or not c['M1_LOGIN_CLIENT_SECRET']: return HttpResponseForbidden('Editor sign-in is awaiting the company Autodesk connection.')
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    req.session['oauth'] = {'state':state,'verifier':verifier,'until':time.time()+600}
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    query = urllib.parse.urlencode({'response_type':'code','client_id':c['M1_LOGIN_CLIENT_ID'],
        'redirect_uri':settings.PUBLIC_URL+'/api/forma/callback','scope':'user-profile:read','state':state,
        'code_challenge':challenge,'code_challenge_method':'S256'})
    return redirect('https://developer.api.autodesk.com/authentication/v2/authorize?'+query)

def editor_callback(req):
    saved = req.session.pop('oauth',None)
    if not saved or saved['until'] < time.time() or not secrets.compare_digest(saved['state'],req.GET.get('state','')):
        return HttpResponseForbidden('Sign-in expired. Please start again.')
    try:
        c = settings.APS_CONFIG
        auth = base64.b64encode((c['M1_LOGIN_CLIENT_ID']+':'+c['M1_LOGIN_CLIENT_SECRET']).encode()).decode()
        token = json.loads(request('https://developer.api.autodesk.com/authentication/v2/token','POST',
            urllib.parse.urlencode({'grant_type':'authorization_code','code':req.GET['code'],
            'redirect_uri':settings.PUBLIC_URL+'/api/forma/callback','code_verifier':saved['verifier']}).encode(),
            {'Authorization':'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'}))
        profile = json.loads(request('https://api.userprofile.autodesk.com/userinfo',headers={'Authorization':'Bearer '+token['access_token']}))
        email = profile.get('email','').strip().lower()
        if profile.get('email_verified') is not True or not Editor.objects.filter(email=email,active=True).exists():
            return HttpResponseForbidden('Your verified Autodesk email is not on the M1 editor list.')
        req.session.cycle_key()
        req.session['editor_email'] = email
        req.session['editor_until'] = time.time()+8*3600
        return redirect('/sharing/')
    except Exception:
        return HttpResponseForbidden('Autodesk sign-in could not be completed. Please start again.')
