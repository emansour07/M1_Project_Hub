# M1 Project Hub

Public dashboard: https://emansour07.github.io/M1_Project_Hub/

Cloudflare API and owner controls: https://m1-project-api.eslam-mansour.workers.dev/admin

## Pages

- Reviews: status and discipline charts, due-in-48-hours and overdue filters, workflow register and Autodesk links. No drawing workload or package popup.
- Knowledge Hub: searchable existing-to-proposed asset-code crosswalk from the current TIDP's Asset Tagging Naming sheet. Submission, review, CDE and coordination procedures remain placeholders for the M1 team.
- Model Progress: received reference drawings/models, developed RVT and infrastructure DWG models, separate LOG and LOI from the tracker, and actual ACC file updates older than seven days.

## Data sources and matching

M1 project e80ed581-2f73-4b70-a8d1-f100b9b95f4d is in ACC EU. Fixed source IDs are in sources.mjs. Original references exclude Other Assets. Both progressed-model folders are checked recursively. The TIDP and tracker are retrieved from their current ACC item tips, so new versions retain the same source links.

Asset codes match complete filename fields or whole folder-name tokens. Ambiguous old codes remain unresolved. Original receipts are grouped by asset and discipline; receipt does not establish approval or completeness. The tracker provides the developed-model list for the missing-file comparison. Duplicate tracker names do not produce an invented percentage. Unknown progress is not zero. LOG and LOI are never blended. All developed models are checked for staleness, including those without a matching tracker row.

Scans use SQLite rows per folder and file, retain the last complete generation, and publish only after all three folder trees finish. Partial and failed scans never replace the complete view. Reference-root visibility must include Island, Mainland and Subsea. The reference count is limited to files the integration can read; folder access must be verified before enabling synchronization.

## Identity and hosting

The separate M1_Project_Hub_Service Server-to-Server APS application uses an Autodesk Secure Service Account (SSA). M1 membership and folder permissions restrict its access. There is no personal-token fallback and no change to SB05. The token scope is data:read. Worker secrets contain the app secret, SSA private key, token encryption key and owner-code pepper; none belong in this repository.

Viewers need no sign-in. Owner-code access protects setup, workbook refresh and owner settings. The historical baseline upload endpoint remains compatible, but the current Model Progress page uses the tracker and mapped original references.

Deployment gates in wrangler.jsonc: FORMA_SYNC_ENABLED enables scheduled updates only after source access is verified. REVIEWS_ACCESS_VERIFIED separately gates review synchronization; an empty list from a restricted member must not be presented as all project reviews.

Each scheduled tick uses at most 20 review reads, 18 folder reads and one workbook download (3 provider requests), plus token renewal. Workbooks refresh every 15 minutes; folder scans restart after five minutes and resume across ticks. Manual refresh is throttled. Cloudflare's free-plan limits still apply.

## Build and validation

Use Node 22.13 or newer:

    npm ci --ignore-scripts
    node --test tests/*.test.mjs
    node build.cjs --release
    npx wrangler deploy

GitHub Actions publishes pages/ from main. The frontend contains no workbook contents or credentials; it reads shared normalized data from Cloudflare. Both workbook and scan failures retain the previous saved data.

## References

[Autodesk SSA](https://aps.autodesk.com/blog/update-secure-service-accounts-ssa-goes-ga), [folder permissions](https://help.autodesk.com/view/DOCS/ENU/?guid=Folder_Permissions), [review permissions](https://help.autodesk.com/cloudhelp/ENU/Docs-Reviews/files/getting-started-reviews/Reviews_Permissions.html), [Data Management](https://aps.autodesk.com/en/docs/data/v2/overview/basics).
