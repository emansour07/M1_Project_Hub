# M1 Project Hub — Django company review

The latest implementation is the **Python/Django company-server version** in [`company/`](company/). This repository is for developer review and release preparation. IT will deploy the user preview internally; pushing here does not deploy Django or change the existing public dashboard.

## Start here

- [IT installation, updates and rollback](company/IT_HANDOVER.md)
- [Feature implementation and source limitations](company/README.md)
- [Environment template](company/.env.example) — placeholders only
- [Release notes](company/RELEASE.txt)
- [Automated checks and downloadable review package](../../actions/workflows/company-review.yml)

The review workflow runs 68 JavaScript tests and 34 Django tests, builds the internal frontend, and produces a ZIP artifact. It does not use live Autodesk credentials or send emails, invitations, uploads or tracker publications. Download the artifact from a successful workflow run, or build locally below.

## Source layout

| Path | Purpose |
| --- | --- |
| `company/hub/` | ACC connection, workbook parsing, scoped data synchronization, permissions, tracker drafts, uploads, reminders and joiner approvals |
| `company/hub/templates/` | Owner/editor forms |
| `company/m1server/` | Django configuration and routing |
| Root HTML/CSS/JavaScript | Frontend source; `build.cjs --company` generates the same-origin internal build |
| `tests/` and `company/hub/test*.py` | Automated checks |
| `cloudflare/`, `application.mjs` | Retained legacy implementation; not required for Django hosting |

## Local developer review

Use the tested Python versions/dependencies described in the handover and Node.js 22 for frontend build tooling. From the repository root:

```text
npm ci --ignore-scripts
node build.cjs --company
python -m venv .venv
```

Activate that virtual environment or use its interpreter explicitly. Install:

```text
python -m pip install -r company/requirements-tested.txt
```

For a localhost-only review, set `DJANGO_DEBUG=true`, a development-only `DJANGO_SECRET_KEY`, and `M1_PUBLIC_URL=http://127.0.0.1:8000` in the shell environment. The `.env.example` file is not automatically loaded. Leave mail/write flags false and use separate local database/media paths.

```text
python company/manage.py migrate
python company/manage.py init_company
python company/manage.py createsuperuser
python company/manage.py runserver 127.0.0.1:8000
```

Open `http://127.0.0.1:8000/` for the viewer and `/owner/` for owner controls. Source-backed sections remain empty until an authorised M1 connection completes synchronization; sample results are not represented as real project data. `runserver` is for local review only. Use the handover's production WSGI and HTTPS instructions for an internal team preview.

```text
node --test tests/*.test.mjs
python company/manage.py test hub
python company/package_company.py dist/M1_Company_Review.zip
```

Git excludes generated `pages/`, database files, private media, keys and credentials. The organisation-chart seed in the separately delivered internal IT package is intentionally absent from this public repository and CI artifacts; import it internally. Never add a populated environment file, project workbook or private key to Git.

## Hosting and deployment status

All target hosting is internal. Autodesk remains the authorised external integration. Company builds remove external Google Fonts and use same-origin API calls. IT must supply the hostname, server environment, M1 credentials, SMTP relay and persistent storage.

Automatic public Pages deployment is disabled. The old Pages workflow is manual and explicitly labelled legacy; it does not deploy the Django application. The existing public dashboard remains its previous deployed version until a separate deployment is requested. See [legacy implementation notes](README_LEGACY.md) for historical context, not current Django operating instructions.

Live company deployment, mail and Autodesk writes remain unverified. The Mainland plan is pending, Island asset placement is pending, and the latest MIDP source must supply Planned/Forecast/MACE_ACC_Status. The confirmed completeness rule counts both `approved` and `approved w/ comments` per asset.
