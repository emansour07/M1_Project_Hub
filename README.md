# M1 Project Hub — Django company review

## 28 November 2026 - Project delivery progress

The Overview starts with a quantity-based view of models and drawings: a project doughnut, then region, asset, discipline and RIBA-stage stacked bars. Scoped Subsea deliverables remain a separate region. Filters cascade and chart segments filter the register. Planned dates select deliverables, not historical snapshots. A51 stays excluded. Every TIDP row remains one deliverable; formats and submission rounds do not increase quantities.

- **Outstanding:** the matched tracker explicitly says Not started.
- **In progress:** tracker activity or internal review, without a matched ARX-SAPAC submission.
- **Submitted to SAPAC:** a matched submission exists. Approved and Approved w/ comments stay green.
- **Returned - awaiting resubmission:** the latest round is Revise and resubmit or Rejected. A later SAPAC resubmission clears an older return, including an older MACE return.
- **Progress not confirmed:** no reliable evidence or an unresolved match. Missing or zero-only updates are not labelled untouched.

Publish external logs through the existing owner submission workspace to populate green/orange figures. Tracker Submitted alone is not evidence of transmission to SAPAC. The view uses the existing MIDP, tracker and knowledge APIs; no migration or new Autodesk permissions are needed.

Export PowerPoint downloads editable charts for the selected filters. Choose project/regions, through assets, through disciplines, or the entire hierarchy; the button previews the slide count. Slides include snapshot date and source/filter notes. CSV includes planned, SAPAC and MACE dates. PptxGenJS is bundled locally for GitHub Pages and the Django package; exports need no cloud presentation service.

## 17 November 2026 — Coordination & quality

The existing dashboard now has **Client RFIs, Navisworks clashes, Our ACC issues and Model QA/QC** tabs. `/admin/assurance` is the owner-only import and mapping workspace. Viewers can filter current registers by scoped asset, discipline, status and inclusive date range, and export CSV with source dates and working-day age. Imports preserve status values, stable IDs and provenance. A later report replaces only the same named register; absent rows are reported as absent, never inferred to be resolved. Import history retains metadata and change counts, not reconstructable historic row snapshots.

- **RFIs:** CSV/XLSX from client ACC. Worksheet/header/column/date-order selection and scoped preview precede publish. No sample client records are seeded. Use one stable register name per source export series.
- **Clashes:** Navisworks Clash Detective XML with Everything (all individual results and groups), all statuses, stable GUIDs and relevant fields; or mapped CSV/XLSX. Raw clashes and group summaries are counted separately. The owner can link saved clash records to synchronized M1 ACC issues. Images referenced by local XML paths are not uploaded or displayed.
- **Issues:** read-only Issues API for the configured M1 project. The Cloudflare cron checks every five minutes in bounded batches; viewers may also Refresh. Only a complete scan replaces the previous results. Incomplete pages, access errors and failures retain the previous complete scan. Placement item filenames and parent folders identify scoped assets. Asset federations are attributed to their scoped asset. Wide federations use Island/Mainland parcel, filename or folder evidence, with the linked view name as fallback for legacy FXX models. Wide issues remain separate from asset totals. Unplaced or ambiguous federations remain project coordination; owners can set Island-wide or Mainland-wide explicitly. Other unmatched issues enter an owner-only scope-review queue; the owner may assign an in-scope asset/discipline or exclude them. No new Autodesk permission or write scope is requested. Assignees not resolved to names are labelled “Assigned in ACC” with the source link.
- **QA/QC:** local check reports, one row per check with stable ID, status/result, model filename and checked ACC version. The dashboard compares imported checks with the latest folder-scan version; it does not execute Revit. Native-model results remain separate from filename/format checks and document approvals. Nested Autodesk result exports may need flattening into the supplied blank CSV template.
- **Checkset:** `assets/M1_Model_Checker_v1.xml` and its HTML guide. Nineteen locally run checks based on Autodesk’s published XML. Prepared/pilot status: schema structure and selected check definitions verified, but not executed in installed Revit/Model Checker. No cloud checking, Flex token use, or source-model edits. Client-query-dependent AIR/COBie rules remain unscored. Civil 3D health checks are outside this Revit checkset.

Build owner HTML from `assurance-workspace.html`, `assurance-core.mjs` and `navisworks-import.mjs` with `node build-assurance.cjs` (also run by the frontend build). Django implements the same routes in `company/hub/assurance.py`, stores reports in existing Snapshot records, and needs no schema migration. Schedule `python company/manage.py sync_issues` every five minutes on the company server, separately from mail/upload tasks. The command is read-only against Autodesk. Back up the database before updates and include assurance report/issue mappings during migration from Cloudflare. Initial production import verification awaits the first real client RFI and Navisworks reports.

For Cloudflare deployments requiring immediate verification, use Wrangler's `--durable-objects-code-update-mode immediate`; otherwise an active Durable Object can continue serving the earlier release until the deferred update applies. Verify both `X-M1-Worker` and `X-M1-Release`, then `/api/assurance`, before publishing the frontend.

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


## 16 November 2026 — Working calendar and date-range reports

The approved working week is Saturday through Thursday. Friday alone is excluded; no public holidays or office-hour calendar is assumed. Durations retain fractional days and use Saudi project time (UTC+03). Review age/cycle, overdue duration and the two-working-day warning use this calendar. Source deadlines are not shifted. Model age warnings use seven working days.

Date filters have inclusive From/To dates and a selectable date field. Missing dates remain visible without a range and are excluded while a range is selected; reversed ranges are rejected. Exports retain the underlying dates, not just durations. Date-range reports filter the current records; they are not reconstructed historical status snapshots.

M1 adds review submission/due/completion ranges, any tracker date field, analysis target dates, original-model update dates, Shared-checker file update dates and Requirements needed-by/last-update dates. The MIDP continues to use its approved Planned date range and preserves the original Excel formatting. Original Design now includes an asset-by-discipline matrix, with received/expected counts, missing-model/format drill-down and CSV exports. Matched files link to ACC items; missing files link to the related observed folder or the reference root, never an invented file location. The 54 unassigned expectations stay outside asset totals.


## MIDP assembled from current TIDPs

The MIDP register now reads the latest versions of scoped `_TIDP_*.xlsx` items directly from the main ACC `2.1_TIDP` folder. Temporary subfolders and unscoped files are excluded. Renamed assets are also resolved when a TIDP Introduction explicitly states a unique former scope code and zone; no name similarity is used to guess a mapping. The four original MIDPs used for original-model analysis are a separate baseline. No source Excel is edited.

Cloudflare checks the source list every 15 minutes after a completed merge and processes changed workbooks in bounded batches. The last complete merge remains visible until all sources pass parsing and version verification. Unchanged versions are reused. The initial merge takes several batches; Refresh advances it. Individual rows link to their source TIDP. Each in-scope TIDP row is a separate deliverable, identified by source item, worksheet and row. Repeated filenames are flagged without merging descriptions, dates or approval values. The Checker charts affected rows by discipline with filters and a row-level CSV export; Refresh in the Checker checks both TIDPs and shared folders. Source corrections clear warnings after the next complete scan. Per-asset MIDP completeness also counts rows. Model-file format grouping in folder scans remains separate. Missing scope sources are reported.

Export the full filtered MIDP with no dates selected, or an inclusive Planned-date range with both dates selected. Forecast, approval and exchange-date fields are retained. The Excel workbook follows M1_MIDP_Consolidated_Live.xlsm: Summary, hidden Index/Data, Settings and one tab per asset with discipline/category groups. It preserves the 54 template columns, then MACE_ACC_Status, Planned Date and Forecast Date, and adds a row-level TIDP sources sheet. Only selected rows enter any visible or hidden sheet. The exported XLSX contains no macros or local-folder connections; refresh in the dashboard and export again. The checked-in layout contains only blank headers, styles and asset-tab mappings. It is a static export of the last complete dashboard merge, not a write-back to ACC. Unsupported date systems, changed layouts and read failures retain the previous complete register.

### 18 November 2026 — original parcels and TIDP refresh

The checker now uses the original parcel picklist from the current TIDP, including 102 for Island and 121 for Mainland. FXX is no longer an enforced or accepted parcel. Corrections are suggested only where the asset section identifies one parcel. Legacy FXX stays in internal identity normalization so historical tracker/model records can still match across the naming change.

TIDP downloads are streamed into a compact in-memory read copy (80 MB compressed / 700 MB selected XML limits), retaining delivery cells and formatting in the supported A:IV area while dropping excess formatted columns. Source ACC workbooks are never modified. A replaced source version restarts an incomplete merge against the current folder; the previous complete MIDP remains available until every current source is validated. Normal workbook download limits remain unchanged.
