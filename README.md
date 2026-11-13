# M1 Project Hub — Django company review

The M1 dashboard temporarily runs on the existing **GitHub Pages + Cloudflare** deployment while IT prepares internal hosting. The portable **Python/Django company-server version** remains in [`company/`](company/). Both implementations now include the internal engineering Requirements Register.

## Start here

- [IT installation, updates and rollback](company/IT_HANDOVER.md)
- [Feature implementation and source limitations](company/README.md)
- [Environment template](company/.env.example) — placeholders only
- [Release notes](company/RELEASE.txt)
- [Automated checks and downloadable review package](../../actions/workflows/company-review.yml)

The review workflow runs 74 JavaScript tests and 38 Django tests, builds the internal frontend, and produces a ZIP artifact. It does not use live Autodesk credentials or send emails, invitations, uploads or tracker publications. Download the artifact from a successful workflow run, or build locally below.

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

Public Pages deployment is enabled temporarily by owner request while IT prepares the internal preview. It builds the Cloudflare-connected frontend; it does not deploy Django. Cloudflare Worker deployment is performed separately before the frontend update. See [legacy implementation notes](README_LEGACY.md) for historical context, not current Django operating instructions.

Live company deployment, mail and Autodesk writes remain unverified. The Mainland plan is pending, Island asset placement is pending, and the latest MIDP source must supply Planned/Forecast/MACE_ACC_Status. The confirmed completeness rule counts both `approved` and `approved w/ comments` per asset.

## Collaborative requirements register

Open **Requirements** in the dashboard, then the authenticated workspace. Approved internal Autodesk editors can create and edit within their assigned asset/discipline scope; the project owner can organise and contribute across the register. No owner approval gate or subcontractor submission is involved in this first phase. Each requirement records its information need, system, element, modelling use, parameter, type, units, required format, acceptance criteria, contributing/internal teams, interfaces, due date and reference. Comments, revision history, stale-edit protection, copying and filtered CSV export are supported. Unknown technical requirements are left for teams to define.

The register is private to assigned editors/owner; it is not exposed by the public dashboard API. Archived entries and change history are retained. The Django version uses the same schema and workspace UI (migration 0005). Moving live Cloudflare register records to the internal database will require a controlled data migration before cutover; a code deployment does not transfer these records automatically.
