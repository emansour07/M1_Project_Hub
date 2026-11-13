# M1 company-server handover

Start with **[IT_HANDOVER.md](IT_HANDOVER.md)** for the internal deployment, network requirements, persistent storage, update and rollback procedures. All hosting stays within the company; Autodesk remains the external project integration.

This is the Python/Django implementation of the M1 Project Hub, with its existing HTML/JavaScript frontend. Both run on the company origin. The deployment package contains prebuilt frontend files, so Node.js, Cloudflare and ChatGPT hosting are not runtime dependencies.

The current GitHub/Cloudflare dashboard has **not** been replaced or deployed from this working copy. Company deployment and live Autodesk write/email verification remain pending IT configuration.

## Implemented

- Internal Requirements Register: assigned discipline/asset collaboration, structured information requirements, comments and revision history, conflict checks, copying and filtered CSV export. The project coordinator can organise and contribute without an approval gate. Subcontractor submissions are deferred. Cloudflare and Django use the same schema/UI; runtime records require a separate controlled migration at cutover.

- MIDP category, asset, discipline, originator, format, approval and inclusive **Planned date** filters. Planned/Forecast are read by header. No fallback to exchange Issue Date. Filtered Excel preserves retained rows, cell styles and worksheet layout; excluded deliverable rows and sheets are removed from the export.
- `MACE_ACC_Status` is read without inventing a value. Per-asset completeness divides approved deliverables by total deliverables for that asset; blank statuses remain in the denominator. Matching model exchange formats count once. Conflicting duplicate statuses do not count as approved. The confirmed rule counts `approved` and `approved w/ comments`; `revise and resubmit` and `rejected` do not count. This rule is enabled on installation and remains editable in the owner workspace.
- Knowledge Hub holds project information, scoped responsibilities, asset-code mapping, the supplied organisation chart, and interactive masterplans. Submit/review instructions are in Duties. Owners edit content and links through forms.
- Shared checker operates in each actual subfolder: native model + NWC, descriptions on all scoped documents, ACC version comparison, and TIDP naming checks. Review-folder model format checks require native + NWC + IFC + DWFX. Ordinary non-infrastructure CAD drawings do not satisfy a native model requirement.
- Weekly uploads use actual, unambiguous observed folders or owner-verified destinations. Autodesk editors must be assigned both the asset and discipline. Filename identity and destination are checked. Existing files require a separate version confirmation, and a concurrent source change stops publication.
- Wednesday 14:00 Asia/Dubai reminder queue, editable recipients, pause/resume and an SMTP outbox. Pausing cancels pending weekly messages; already accepted mail cannot be recalled. Reminders are initially paused.
- Joiner form with the actual roles in use by M1 project members. Approval notifications go to **eslam.mansour@arx.ing**. Email links open an authenticated review page; GET never approves. Approval queues a M1-only Docs-member invitation with the requested project role. No administrator product access is granted. Existing members retain their current permissions and are flagged for owner review. Uncertain provider results stop automatic retry.
- Tracker fields, assigned editor drafts, owner preview/reject/publish, source-version conflict detection, formula/identity protection and XML cell patching. Source workbook publication creates a new ACC version only after approval.
- Python SSA authentication, complete-source synchronization, in-scope retention, current MIDP/tracker parsing, four-original-MIDP comparison, review workflow contents, and source folder format checks. A failed refresh retains the last complete dataset.

## Required from IT

1. Final HTTPS URL and operating system/reverse proxy arrangement. The application currently assumes the root of a dedicated hostname, not a subpath.
2. An arx.ing **sender mailbox** and SMTP relay credentials/authorization. The sender domain and notification recipient are known; the actual sender mailbox is not yet supplied. Microsoft Graph mail transport is not implemented.
3. The existing **M1** SSA credentials/private-key file and editor-login APS client credentials installed in the service environment. Do not reuse SB05. Register the company callback `<M1_PUBLIC_URL>/api/forma/callback` on the M1 login application.
4. Database location and backup policy. SQLite is the supplied single-server default. If company policy requires PostgreSQL, install its Django driver and configure `DATABASES` in an IT-specific settings module before migration. Use one configured application database for the web service and scheduler.
5. Approval of the new company's production deployment and a first connection verification. The included tests mock external writes; no real invitation, model upload or tracker publication was sent during development.

## Deployment

From the unpacked package root, create a Python environment and install `company/requirements-tested.txt`. Configure the environment keys shown in `company/.env.example` using the company secret store/service manager. Keep `M1_DB_PATH` and `M1_MEDIA_ROOT` outside release directories; copy the seeded organisation chart into persistent media only on first installation. Do not publish a populated environment file or private key. `DJANGO_SECRET_KEY` is mandatory. Keep DEBUG false in production.

Run:

```text
python company/manage.py migrate
python company/manage.py init_company
python company/manage.py createsuperuser
python company/manage.py collectstatic --noinput
python company/manage.py check --deploy
python company/manage.py sync_roles
python company/manage.py sync_project
```

The owner enters their own account credential during `createsuperuser`; no credential is shipped in the package. `/owner/` is the management entry point, and public viewers use `/` without sign-in. Approved editors use Autodesk sign-in.

Run a production WSGI server from `company/`, for example:

```text
waitress-serve --listen=127.0.0.1:8000 --url-scheme=https m1server.wsgi:application
```

Expose it through the company HTTPS reverse proxy and serve `/static/` from `company/staticfiles/`. Keep `/runtime-config.js`, `/api/`, `/owner/`, `/admin/`, `/auth/`, `/editor`, `/sharing/`, `/access-request/` and `/` routed to Django. Keep `company/private/` outside all static roots. If TLS terminates at a proxy, IT must configure Django's trusted proxy HTTPS handling only after ensuring that the proxy strips untrusted forwarded headers. Set request body limits and timeouts for model uploads (application maximum 2 GB).

Schedule this with the same environment and database **every minute** using Windows Task Scheduler or the company Linux scheduler:

```text
python company/manage.py run_jobs
```

It sends due reminders, processes approved invitations, and refreshes project sources when queued or due (five-minute cadence). Viewer Refresh queues a source refresh. Long jobs have database claims so overlapping scheduler invocations do not duplicate actions. A process terminated during a write is intentionally not auto-retried: IT must check ACC/mail records before recovering a `provisioning`, `sending`, `publishing`, or `verification_required` record. A stopped read-only sync can be reset to queued after confirming the old process has exited.

After read-only verification, enable the appropriate environment flags individually: `M1_MAIL_ENABLED`, `M1_PROVISION_ENABLED`, `M1_UPLOAD_ENABLED`, `M1_TRACKER_WRITE_ENABLED`. Folder-role inheritance in ACC remains authoritative. Adding a role is not a separate folder-permission grant or a subscription/license assignment.

## Owner setup

- `/owner/`: content, editor emails, reminder controls, joiner approval, tracker drafts, masterplans and completeness rules.
- Add editor permissions using asset/discipline/field checkboxes. Removing or deactivating an editor takes effect on the next request.
- Refresh project roles from the owner workspace. The project-member API only exposes roles currently in use; an unused role may need an existing project assignment before it appears. No hub-admin role catalogue is requested.
- Enter reminder recipients and the confirmed arx.ing sender. Resume only after the mail connection is working.
- The confirmed `MACE_ACC_Status` options are `approved`, `approved w/ comments`, `revise and resubmit`, and `rejected`. Both approved statuses count. For each asset: approved MIDP documents / total MIDP documents assigned to that asset × 100. Matching is case-insensitive and ignores surrounding whitespace; blank and unrecognised statuses remain unapproved in the denominator.
- The supplied organisation chart was rendered from `261101_M1_PkgF_OrgChart_&_RACI.xlsx` using its DrawingML positions. The original Excel remains authoritative. To regenerate after a source update, run `python company/manage.py import_orgchart <workbook>`.
- For masterplans, add approved PNG/JPEG exports in the owner workspace, then choose **Place assets on plan**. Select an in-scope asset and click its location. Prefer highlighted Revit-derived buildings where sources differ. Island source is identified, but the actual plan image/hotspots are not yet imported. The owner confirmed the Mainland masterplan is not ready and will provide it later. No asset locations have been guessed.

## Source audit and validation

The available `MIDP_M1.xlsx` v2 has Project Stage and exchange Issue Dates, but no Planned/Forecast or MACE_ACC_Status columns yet. It also has no approval-derived completeness field. The new reader supports the planned columns and status field when the team publishes the updated MIDP. Recorded Project Stage is displayed; it is not inferred from issue dates.

Automated tests cover permissions, CSRF, duplicate and uncertain invitations, real-role validation, Dubai scheduling/pause, workbook filters/layout, exact approval matching, scope exclusion, same-folder format requirements, native-model age, and protected tracker cell patching. Browser checks covered navigation, Knowledge Hub/orgchart and the public request form. Live company connections and real ACC writes are not yet verified.

Autodesk implementation references:

- [Official Account Admin OpenAPI](https://github.com/autodesk-platform-services/aps-sdk-openapi/blob/main/forma/accountadmin/accountadmin.yaml)
- [Hub Admin tutorial](https://aps.autodesk.com/en/docs/acc/v1/tutorials/admin)
- [File description field](https://aps.autodesk.com/blog/fetch-description-attribute-file-item-acc-and-bim360)
- [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)
