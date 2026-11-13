# M1 Project Hub — internal hosting and future updates

Prepared 13 November 2026 • Owner: Eslam Mansour • Approval email: eslam.mansour@arx.ing

## Hosting requirement

Host the complete application inside ARX infrastructure: frontend, Python/Django backend, database, uploaded media, logs, backups and source repository. Do not deploy this package to GitHub Pages, Cloudflare or ChatGPT. An internal Git server is optional; release ZIP files can be used without any Git service.

Autodesk ACC/Forma remains the project data source and approved external integration. No public inbound access is required by this implementation: staff reach the site through the company network/VPN. The editor's browser must reach both Autodesk and the internal callback URL during sign-in. Verify that the chosen HTTPS callback is accepted by the M1 APS application before go-live.

Viewers need no application login once on the permitted company network. This is enforced by the network/reverse proxy, not a viewer email allow-list. Owner controls require Django sign-in. Editors use verified Autodesk accounts that the owner has explicitly approved.

## Package contents

- `company/`: readable Django source, migrations, templates, tests and operating instructions.
- `pages/`: readable, prebuilt HTML/CSS/JavaScript and local images. These are the deployable frontend source files; no Node.js or browser CDN is required. Company builds use system-font fallbacks.
- `company/private/media/orgchart.svg`: initial organisation-chart seed only. Copy it into persistent media on first installation; do not overwrite a newer chart on updates.
- `company/requirements-tested.txt`: exact Python dependency versions used for validation. `requirements.txt` records compatible dependency ranges for planned maintenance.
- `MANIFEST.sha256.json`: per-file integrity hashes. Verify before modifying or deploying the package.

No database, Autodesk credentials, mailbox credentials, populated environment file or raw project workbook is included. The package does contain the supplied organisation chart and project configuration; retain it internally.

## Decisions IT must supply

1. Dedicated internal HTTPS hostname, DNS, TLS certificate and network/VPN access policy. Root-path hosting is required; a URL such as `/tools/m1/` has not been implemented.
2. Windows/IIS or Linux reverse proxy and service-manager arrangement. Use a production WSGI server; the included example uses Waitress.
3. Service identity, persistent data paths, database choice, backup retention, monitoring and restore owner.
4. An approved arx.ing sender mailbox and SMTP relay. Microsoft Graph mail is not implemented. The recipient for joiner approvals is already eslam.mansour@arx.ing.
5. M1-only Autodesk SSA credentials and editor-login application credentials installed through the company secret store. Existing SB05 credentials must not be substituted.

Python 3.14.7 was used for this package's local tests. Validate the company's supported Python runtime and dependency set in staging. SQLite is the supplied single-server database; keep it on a local disk, not a network share. PostgreSQL requires an IT settings module and driver, and has not been integration-tested for this release.

## Permanent storage and release layout

Use separate code releases and persistent state. Example structure, using an IT-selected absolute base path:

```text
M1/
  releases/<release-id>/company/
  releases/<release-id>/pages/
  state/m1.sqlite3
  state/media/
  secrets/                 # restricted service access
  backups/                 # company backup policy
  logs/
```

Set `M1_DB_PATH` and `M1_MEDIA_ROOT` to absolute paths under `state`, outside every release directory. Store the SSA key outside the release and set `APS_SSA_PRIVATE_KEY_PATH`. Keep the same production `DJANGO_SECRET_KEY` across routine updates. Both web and scheduled jobs must use the same production environment and database.

Create a dedicated virtual environment per release. Never extract a new ZIP over the live release or replace the production database with a development copy. Only `/static/` should expose collected static assets; never expose the ZIP, source tree, private media directory, secrets, logs or database as a web directory.

## First installation

Run these from the extracted release root. `python` below must be the selected virtual environment's interpreter.

```text
python company/verify_package.py
python -m venv .venv
```

Use `.venv/Scripts/python.exe` on Windows or `.venv/bin/python` on Linux for subsequent Python commands. Install dependencies through the company's approved Python mirror:

```text
python -m pip install -r company/requirements-tested.txt
```

For offline installation, IT should prepare a wheelhouse for the target OS, CPU and Python version, then use `--no-index --find-links=<internal-wheelhouse>`. Dependency installation is a build/maintenance step, not an application runtime connection.

Configure all values in `company/.env.example` through the service manager/secret store. This file is documentation and is **not automatically loaded**. Use the actual hostname in `DJANGO_ALLOWED_HOSTS` and the same HTTPS origin in `M1_PUBLIC_URL`; keep `DJANGO_DEBUG=false`. Configure all four mail/write flags as false initially. Create the persistent media directory and copy the seeded organisation chart there once.

```text
python company/manage.py migrate --noinput
python company/manage.py init_company
python company/manage.py createsuperuser
python company/manage.py collectstatic --noinput
python company/manage.py check --deploy
```

The owner enters their own credential at `createsuperuser`; no default password is supplied. Resolve deployment-check findings for the actual hosting configuration.

The local production-settings check reported only HSTS subdomain/preload warnings (W005/W021). These are left unset because the company's hostname and subdomain policy are unknown. IT should document its decision; do not enable a domain-wide policy or public preload submission automatically for an internal site.

Register `<M1_PUBLIC_URL>/api/forma/callback` on the M1 editor-login APS application, then configure the M1 SSA's existing project membership and folder access. Read-only access supports data refresh. Membership provisioning, file uploads and tracker publication require the corresponding Autodesk permissions and separate application flags.

```text
python company/manage.py sync_roles
python company/manage.py sync_project
```

An initial complete sync is required before the source-backed pages have data. No previous Cloudflare database or editor settings are imported by this package. Configure editors, duties and operational settings in `/owner/`; approved project data is fetched again from ACC.

## Web service and scheduler

From the release's `company/` directory, an example HTTPS-only reverse-proxy deployment is:

```text
waitress-serve --listen=127.0.0.1:8000 --url-scheme=https m1server.wsgi:application
```

The example assumes the reverse proxy is on the same server, accepts only HTTPS application traffic, and redirects HTTP before proxying. The backend must not be reachable directly by staff. Preserve the original Host header. If IT uses forwarded headers instead, explicitly trust only the known proxy and strip client-supplied forwarded headers. Also configure trusted client-IP forwarding for request rate limits; otherwise all users may appear as the proxy address. Do not set a wildcard trusted proxy.

Serve `/static/` from the active release's `company/staticfiles/`; route all other paths to Django. Do not cache `/`, `/runtime-config.js`, APIs or authenticated pages. Support request sizes/timeouts and temporary disk capacity appropriate for model uploads; the application limit is 2 GB. The public URL, web service and static-files release must switch together on updates.

Register `python company/manage.py run_jobs` every minute using the same interpreter, working directory and environment as the web service. Configure the scheduler to avoid overlapping instances. This performs queued refreshes and a five-minute refresh cadence, approved invitations and due mail. Reminders are Wednesday 14:00 Asia/Dubai and begin paused. Schedule Django `clearsessions` regularly as part of housekeeping. Capture service/scheduler errors without logging secrets or signed Autodesk URLs.

## Permitted connections

- Staff browser to the internal dashboard over HTTPS; Autodesk sign-in and ACC links when requested.
- Backend HTTPS to `developer.api.autodesk.com` and `api.userprofile.autodesk.com`.
- Backend HTTPS to Autodesk-issued signed file-transfer storage endpoints; this implementation validates Amazon S3 hostnames ending in `.amazonaws.com`. These are part of Autodesk file transfer, not separate dashboard hosting. Agree the observed endpoints with IT's firewall policy.
- Backend to the company-approved SMTP relay and internal database, if used.

No Google Fonts/CDN request, public Git repository, Cloudflare runtime or ChatGPT runtime is needed. User-added external hyperlinks remain ordinary links and should follow company policy.

## Go-live acceptance

In staging first, verify viewer navigation and source timestamps; MIDP Planned/Forecast/status fields and planned-date export; scoped tracker and checker results; owner sign-in; one approved Autodesk editor and one unapproved account; editor asset/discipline restrictions; and the organisation chart/media paths. Compare sampled results with the actual ACC source.

Then test mail to a designated test recipient and owner approval notifications. With the project owner's explicit operational approval, test an agreed upload/version, tracker draft approval/publication and joiner invitation. Enable `M1_MAIL_ENABLED`, `M1_PROVISION_ENABLED`, `M1_UPLOAD_ENABLED` and `M1_TRACKER_WRITE_ENABLED` individually only for verified functions. Remove test recipients and resume reminders when the owner is ready. Do not process a staging copy of production's pending outbox or approved requests.

Local validation covers 34 Django and 68 JavaScript tests. External mutations were mocked. Real company hosting, email, Autodesk writes and PostgreSQL are not yet verified. Mainland masterplan is not ready; Island asset points are not imported. Planned/Forecast and MACE_ACC_Status await the refreshed source MIDP. These source gaps should not be represented as populated results.

The extracted release also passed its file manifest check and a Waitress production-settings smoke test for the dashboard and same-origin configuration. This is a local service check, not a company reverse-proxy or Autodesk integration test.

## Future updates — no external hosting required

Routine duties, links, editor permissions, reminder recipients, pause/resume, completeness rules and masterplans are edited through `/owner/`. ACC source changes are fetched by synchronization. Neither needs a code deployment.

For software changes, IT can maintain `company/` and `pages/` in its internal repository, or receive a new versioned ZIP through an approved internal transfer. There is no requirement to give an external assistant access to the production server. Any future assistance must follow company policy for sharing source. Provide the current release ID and describe the change; never send secrets or production database backups.

`pages/` contains editable, unminified frontend modules. After direct frontend edits, run `python company/version_assets.py <new-release-id>` to refresh HTML and module cache tokens. The original development repository also supports `node build.cjs --company`; Node is a development-only option, not needed for packaged-source maintenance. Do not manually edit collected `staticfiles/`: those files are regenerated.

Each release should include an ID, change list, dependency/migration notes, test results and a new integrity manifest. Keep source, infrastructure-specific settings and tests in the internal repository; keep runtime data and credentials outside it. Run backend tests against isolated staging/test settings, never with production mail/write flags or production job queues enabled.

### Installing an update

1. Verify the incoming manifest and release notes. Extract to a new versioned release directory. Install its tested dependencies into its own environment.
2. Test in staging using separate state paths, secret, hostname and jobs. Keep all mail/write flags false until a designated staging test requires them. Use an isolated/sanitised data copy when appropriate; never connect staging to the live database.
3. Schedule maintenance. Pause the scheduler, prevent new owner/editor writes, and let in-flight jobs finish. Record pending/uncertain external actions before stopping the old web service.
4. Back up database, persistent media, configuration and the old release. For SQLite, stop all database-writing processes before a filesystem copy, or use a consistent SQLite backup facility. Include WAL state correctly if WAL is enabled. Use the database-native backup procedure for PostgreSQL.
5. With the existing production state paths and secret, run from the **new** release:

```text
python company/manage.py migrate --plan
python company/manage.py migrate --noinput
python company/manage.py collectstatic --noinput
python company/manage.py check --deploy
```

6. Switch the web service working directory/interpreter, static-file root and scheduler command to the new release. Start the web service and verify sign-in, content, snapshot reads and a representative filtered export. Do not create a new owner or replace the media seed on routine updates. Run `init_company` on updates only if that release's notes require it.
7. Resume jobs, inspect a completed refresh, verify the owner/editor flow, and reopen writes. Keep the previous release and backup for the agreed rollback period. Record deployment time, operator, release hash, migration state and smoke-test result.

### Rollback and recovery

Pause jobs and stop writes first. If the previous code is explicitly compatible with the migrated schema, switch code/static files/services back together. Otherwise restore the matched pre-update database and media backup with the previous release. Do not assume migrations can safely be reversed. A database restore loses changes made after the backup; agree the recovery point with the owner.

An application rollback does not undo an Autodesk invitation, uploaded version, published workbook or delivered email. Reconcile those actions against ACC/mail records before resuming restored queues. Never blindly retry `provisioning`, `sending`, `publishing`, `verification_required` or `needs_attention` records. Read-only sync may be requeued only after confirming its old process is no longer running. Test the restore procedure in staging before production adoption.

## Reference and support

See `company/README.md` for feature details and `company/.env.example` for environment keys. Preserve the release manifest with each backup. Confirm the final URL, sender mailbox and IT support owner with Eslam before go-live.

Deployment guidance follows the [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/) and [Waitress reverse-proxy documentation](https://docs.pylonsproject.org/projects/waitress/en/stable/reverse-proxy.html). These are reference links, not runtime dependencies.
