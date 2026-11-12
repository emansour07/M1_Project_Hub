# M1 Project Hub

Public dashboard: https://emansour07.github.io/M1_Project_Hub/

Cloudflare API and owner controls: https://m1-project-api.eslam-mansour.workers.dev/admin

## Pages

- Reviews: status and discipline charts, due-in-48-hours and overdue filters, workflow register and Autodesk links. No drawing workload or package popup.
- Knowledge Hub: searchable existing-to-proposed asset-code crosswalk from the current TIDP's Asset Tagging Naming sheet. Submission, review, CDE and coordination procedures remain placeholders for the M1 team.
- Model Progress: received reference drawings/models, developed RVT and infrastructure DWG models, separate LOG and LOI from the tracker, and actual ACC file updates older than seven days.

## Data sources and matching

M1 project e80ed581-2f73-4b70-a8d1-f100b9b95f4d is in ACC EU. Fixed source IDs are in sources.mjs. Original references exclude Other Assets. Both progressed-model folders are checked recursively. The TIDP, tracker and MIDP are retrieved from their current ACC item tips, so new versions retain the same source links.

Asset codes match complete filename fields or whole folder-name tokens. Numeric parcel fields scope the mapping to the corresponding section (102 â†’ 10.2, 121 â†’ 12.1). Ambiguous old codes remain unresolved when section evidence is absent. Original receipts are grouped by asset and discipline; receipt does not establish approval or completeness. MIDP model sections define expected asset/discipline groups, excluding the federated-model sheet and drawing sections. The tracker provides the developed-model list for the missing-file comparison. Duplicate tracker names do not produce an invented percentage. Unknown progress is not zero. LOG and LOI are never blended; hidden historical percentage columns are excluded. All developed models are checked for staleness, including those without a matching tracker row.

Scans use SQLite rows per folder and file, retain the last complete generation, and publish only after all three folder trees finish. Partial and failed scans never replace the complete view. Reference-root visibility must include Island, Mainland and Subsea. The reference count is limited to files the integration can read; folder access must be verified before enabling synchronization.

## Identity and hosting

The separate M1_Project_Hub_Service Server-to-Server APS application uses an Autodesk Secure Service Account (SSA). The service account is a project administrator for M1 only, as approved by the owner, so it can read all M1 reviews. The integration remains limited to one project and has no hub-administrator role. There is no personal-token fallback and no change to SB05. Routine synchronization uses data:read. A separate short-lived token with data:read, data:write and data:create is requested only during owner-approved publication of the fixed M1 tracker. Worker secrets contain the app secret, SSA private key, token encryption key and owner-code pepper; none belong in this repository.

Viewers need no sign-in. Owner-code access protects setup, editor access, knowledge content and Excel approvals. Public refresh endpoints only refresh existing read-only data and are rate limited. The historical baseline upload endpoint remains compatible, but the current Model Progress page reads its expected scope directly from the MIDP and combines it with the tracker and mapped original references.

Deployment gates in wrangler.jsonc: FORMA_SYNC_ENABLED enables scheduled updates only after source access is verified. REVIEWS_ACCESS_VERIFIED separately gates review synchronization; an empty list from a restricted member must not be presented as all project reviews.

Each scheduled tick uses at most 20 review reads, 18 folder reads and one workbook download (3 provider requests), plus token renewal. Workbooks refresh every 15 minutes; folder scans restart after five minutes and resume across ticks. Manual folder batches are separated by at least ten seconds and use no more than three concurrent reads. Autodesk rate-limit responses pause the scan for at least five minutes, or its longer Retry-After interval; saved work resumes afterward. Cloudflare's free-plan limits still apply.

## Build and validation

Use Node 22.13 or newer:

    npm ci --ignore-scripts
    node --test tests/*.test.mjs
    node build.cjs --release
    npx wrangler deploy

GitHub Actions publishes pages/ from main. The frontend contains no workbook contents or credentials; it reads shared normalized data from Cloudflare. Both workbook and scan failures retain the previous saved data.

## References

[Autodesk SSA](https://aps.autodesk.com/blog/update-secure-service-accounts-ssa-goes-ga), [folder permissions](https://help.autodesk.com/view/DOCS/ENU/?guid=Folder_Permissions), [review permissions](https://help.autodesk.com/cloudhelp/ENU/Docs-Reviews/files/getting-started-reviews/Reviews_Permissions.html), [Data Management](https://aps.autodesk.com/en/docs/data/v2/overview/basics).

## Model identity, formats and naming checks

Both dashboards count one model per case-insensitive filename stem across its formats; revision suffixes remain distinct. M1 retains the available files behind each model. Native RVT or infrastructure / Civil 3D DWG drives the last-update warning when present, so a recent export does not hide an old native model.

M1 checks the two Shared trees independently for native + NWC, and Review folder co.kWJCSblxQaaYrIWQVDZeow for native + NWC + IFC + DWFX. Exports in another source tree cannot satisfy a missing format. NWD can be displayed but does not substitute for NWC. The bounded format scan publishes only complete results and retains its previous snapshot on failure. It alternates with reference scanning and stays within the same 18-read allowance per invocation; format scans restart every 15 minutes.

Review names open document details with naming warnings and safe suggested filenames. The current TIDP Supporting Data supplies the parcel, originator, stage, package/discipline, type and level picklists; Asset Tagging Naming supplies proposed asset codes. The TIDP filename supplies the field order, six-digit number and Rnn revision pattern (revision optional because model names in the tracker omit it). Proposed codes take precedence; numeric parcels disambiguate legacy codes. Unresolved codes or picklist omissions are highlighted without guessed corrections. This checks the supplied TIDP rules, not a separate unprovided naming appendix. No ACC files are renamed.

A dedicated POST /api/models/refresh performs up to 36 folder reads in its own invocation (plus token renewal); the combined review/model update and scheduled tick retain their 18-read format allowance. Both paths share the same lease, ten-second spacing and provider backoff.


M1 scope and MIDP (November 2026)
- The live M1_TIDP_Log.xlsx Scope mapping tab is the asset allowlist for every page, source-file cache and export. Only required scope columns are retained; local paths and processing notes are discarded. Old/proposed codes are matched by zone, with ambiguous matches left unresolved. Out-of-scope documents and entirely out-of-scope workflows are omitted. Generic external works without a zone remain explicitly unassigned to a zone.
- Scope cleanup removes cached out-of-scope file records in bounded batches. Only active and last complete scan generations are retained. Owner /api/scope/status reports remaining out-of-scope cache records. No ACC source is modified.
- Naming checks require FXX in segment two, and use current TIDP picklists plus actual discipline-tab deliverable codes. The knowledge table shows To confirm where no safe proposed-code match exists.
- MIDP is read from the configured ACC item. The latest valid Issue Date across every data exchange drives inclusive range filtering. Blank/invalid dates are not invented and are excluded from a dated export. Current source V2 has no valid issue dates.
- The Excel range export retains the source sheet layout, styles, columns, merged cells and retained deliverable rows. Unselected deliverable cells and unused asset sheets are removed, and unused shared strings/comments/external-link caches are cleared. Hidden rows contain no excluded deliverable data. No raw workbook is retained on the backend. Parsed ledgers are chunked and obsolete versions are removed.
- Validation: automated scope, naming, model-format, date-range and OOXML-retention checks. A one-row export from the actual MIDP was reopened and visually compared with its source; its style table was byte-identical. QA selection metadata is local only, never published as project data.


## Team delivery workspace (12 November 2026)

- MIDP supports category, asset, discipline, originator, format, search and inclusive issue-date filters. Categories use the filename document-type code before the source section heading. Excel range exports follow these filters.
- Model Progress has Tracker and Analysis tabs. Every named source tracker column is available, including hidden historical LOD columns. Missing MIDP models appear as amber rows with unknown progress, not invented percentages. Filters, column selection and CSV exports are provided.
- The four workbooks in the configured original-MIDP folder define the expected original-model list. Matches use the approved asset mapping and filename identity across formats/revisions. Reference drawings alone cannot satisfy an expected model. Only scoped parsed rows are cached; the large workbooks are parsed one worksheet at a time.
- For tracker reconciliation, ARX and SAP are equivalent only when the remaining name segments match after asset-code mapping. Scope IDs remain distinct. Tracker names supply suggested MIDP corrections, preserving the MIDP revision. The correction CSV does not modify the live MIDP.
- Knowledge Hub duties and guidance are plain-text owner-editable sections at /admin/content, with validated HTTPS links. The initial duties use the agreed Shared and Review format rules. Detailed procedures remain project-team placeholders.
- /admin/editors lets the owner manage approved Autodesk email addresses and asset, discipline and field assignments. /editor is the editing workspace. Viewers remain public. Owners keep their existing owner-code login.
- Editor authentication uses the separate traditional M1_Project_Hub APS app, M1_LOGIN_CLIENT_ID and M1_LOGIN_CLIENT_SECRET Worker secrets, the existing /api/forma/callback and only user-profile:read. OAuth uses state, PKCE and verified-email allowlisting. Tokens are not retained; opaque eight-hour HttpOnly sessions are stored hashed. Removing an editor revokes access on the next request.
- Editors save private drafts. Owner-only proposed-workbook downloads and publication check current cell values, scope and formula protection. Publication adds a new version to the fixed tracker item only. Unrelated OOXML parts are preserved. A changed source stops publication; uncertain results lock the draft for manual ACC version verification rather than retrying blindly.
- Approved team fields are Delivery status, Responsible team, Target date, Blocker and Last update. Status values are Not started / Active / On hold / Complete; absent input remains Not reported. Approval writes these to additional columns in the source Tracker sheet, then refreshes the public snapshot.
- Validation: 62 automated tests; live Autodesk sign-in and rejection of an unlisted identity; anonymous editor/preview access rejected; real tracker copy edited and visually checked. No test progress or fake editor emails were saved in production. The first real Excel publication requires an owner-approved draft and has not been performed as a test.
