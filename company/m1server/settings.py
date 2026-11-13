import os
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BASE_DIR.parent
DEBUG = os.getenv('DJANGO_DEBUG') == 'true'
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', '')
if not SECRET_KEY:
    raise ImproperlyConfigured('Set DJANGO_SECRET_KEY in the server environment.')
ALLOWED_HOSTS = os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
PUBLIC_URL = os.getenv('M1_PUBLIC_URL', 'http://127.0.0.1:8000').rstrip('/')
if not DEBUG and not PUBLIC_URL.startswith('https://'):
    raise ImproperlyConfigured('Production M1_PUBLIC_URL must use HTTPS.')
INSTALLED_APPS = ['django.contrib.admin', 'django.contrib.auth', 'django.contrib.contenttypes',
                  'django.contrib.sessions', 'django.contrib.messages', 'django.contrib.staticfiles', 'hub']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'hub.middleware.ResponseHeaders', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
              'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.contrib.messages.middleware.MessageMiddleware',
              'django.middleware.clickjacking.XFrameOptionsMiddleware']
ROOT_URLCONF = 'm1server.urls'
WSGI_APPLICATION = 'm1server.wsgi.application'
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [], 'APP_DIRS': True,
              'OPTIONS': {'context_processors': ['django.template.context_processors.request',
                  'django.contrib.auth.context_processors.auth', 'django.contrib.messages.context_processors.messages']}}]
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3',
              'NAME': os.getenv('M1_DB_PATH', str(BASE_DIR / 'private' / 'm1.sqlite3')), 'OPTIONS': {'timeout': 30}}}
# IT can replace DATABASES via a deployment-specific settings module for PostgreSQL.
LANGUAGE_CODE = 'en-gb'
TIME_ZONE = 'Asia/Dubai'
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [REPO_DIR / 'pages'] if (REPO_DIR / 'pages').exists() else []
MEDIA_ROOT = Path(os.getenv('M1_MEDIA_ROOT', str(BASE_DIR / 'private' / 'media')))
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
LOGIN_URL = '/admin/login/'
AUTH_PASSWORD_VALIDATORS = [{'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 12}}]
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = os.getenv('EMAIL_HOST', '')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', '587'))
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = os.getenv('EMAIL_USE_TLS', 'true') == 'true'
EMAIL_TIMEOUT = 30
M1_MAIL_ENABLED = os.getenv('M1_MAIL_ENABLED') == 'true'
M1_PROVISION_ENABLED = os.getenv('M1_PROVISION_ENABLED') == 'true'
M1_UPLOAD_ENABLED = os.getenv('M1_UPLOAD_ENABLED') == 'true'
M1_TRACKER_WRITE_ENABLED = os.getenv('M1_TRACKER_WRITE_ENABLED') == 'true'
M1_PROJECT_ID = 'e80ed581-2f73-4b70-a8d1-f100b9b95f4d'
M1_REGION = 'EMEA'
M1_NOTIFICATION_EMAIL = os.getenv('M1_NOTIFICATION_EMAIL', 'eslam.mansour@arx.ing')
DEFAULT_FROM_EMAIL = os.getenv('M1_SENDER_EMAIL', '')
APS_CONFIG = {key: os.getenv(key, '') for key in ['APS_CLIENT_ID', 'APS_CLIENT_SECRET', 'APS_SSA_ID', 'APS_SSA_KID', 'APS_SSA_PRIVATE_KEY_PATH', 'M1_LOGIN_CLIENT_ID', 'M1_LOGIN_CLIENT_SECRET']}
Path(DATABASES['default']['NAME']).parent.mkdir(parents=True, exist_ok=True)
