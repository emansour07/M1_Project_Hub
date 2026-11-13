from django.contrib import admin
from django.urls import path
from django.shortcuts import redirect
from hub import views, auth

urlpatterns = [
    path('', views.dashboard),
    path('runtime-config.js',views.config),
    path('assets/forma.ico',lambda r:redirect('/static/assets/forma.ico')),
    path('assets/arx.svg',lambda r:redirect('/static/assets/arx.svg')),
    path('admin/',admin.site.urls),
    path('admin/content',lambda r:redirect('/admin/hub/contentsection/')),
    path('admin/editors',lambda r:redirect('/admin/hub/editor/')),
    path('admin/reminders',lambda r:redirect('/admin/hub/remindersettings/')),
    path('access-request/',views.access_request),
    path('owner/access/<uuid:ident>/',views.access_review),
    path('auth/editor/login',auth.editor_login),
    path('api/forma/callback',auth.editor_callback),
    path('sharing/',views.sharing),
    path('editor',views.tracker_editor),
    path('owner/',views.owner_home),
    path('owner/tracker/<uuid:ident>/',views.tracker_approval),
    path('owner/tracker/<uuid:ident>/preview',views.tracker_preview),
    path('api/content',views.content),
    path('api/midp/export',views.midp_export),
    path('api/completeness',views.asset_completeness),
    path('api/refresh',views.refresh),
    path('api/<str:kind>/refresh',views.refresh),
    path('api/orgchart/image',views.orgchart),
    path('api/masterplans',views.masterplans),
    path('api/masterplans/<int:ident>/image',views.plan_image),
    path('owner/masterplan/<int:ident>/',views.map_editor),
    path('owner/masterplan/<int:ident>/image',views.owner_plan_image),
    path('api/<str:key>',views.snapshot),
]
