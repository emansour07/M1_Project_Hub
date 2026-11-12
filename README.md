# M1 Project Hub

Separate M1 dashboard prepared for GitHub Pages and a Cloudflare Worker. It does not modify the SB05 dashboard, use its saved reviews or copy its secrets.

## Pages

- Reviews: coloured status chart, discipline workload, deadline KPIs (including due in 48h), searchable/filterable register, CSV export and direct Autodesk review links. No drawing workload or package-content popup.
- Knowledge Hub: searchable placeholders for submission, review, CDE and model-coordination procedures. Actual M1 content will be supplied by the project team; no generic procedures are presented as project rules.
- Model Progress: original-design availability by asset and discipline, matching evidence, missing deliverables, unmapped-file count and CSV export.

## Project configuration

- M1 ACC project: e80ed581-2f73-4b70-a8d1-f100b9b95f4d, EU region.
- Original design source: 0.5.4_Reference_Drawings (Island, Mainland, Other Assets and Subsea).
- Baseline source: MIDP_M1.xlsx supplied by the project owner. Asset/discipline and original-file mappings must be verified before publishing availability conclusions.
- Public team dashboard: https://emansour07.github.io/M1_Project_Hub/
- Separate backend: https://m1-project-api.eslam-mansour.workers.dev
- Owner controls require a private owner code. Team viewing does not require sign-in.
- Autodesk authorisation and the baseline mapping are pending. Scheduled synchronisation remains disabled until setup is complete.

## Build and validate

Requires Node 22+.

```sh
node --test tests/*.test.mjs
node build.cjs
```

The `pages/` folder is the static frontend. Serve it over HTTP. `node build.cjs --release` refuses publication until the M1 project ID, API origin and Pages URL are configured.

## Hosting

Set the confirmed values in `config.js` and `wrangler.jsonc`; select the intended Cloudflare account. Keep `FORMA_BATCHED=true`. Add Cloudflare Worker secrets through Wrangler's hidden-input prompts: `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_CALLBACK_URL`, `APS_TOKEN_KEY` (32 random bytes encoded as base64), and a new `M1_ADMIN_KEY` (at least 40 random characters). Never reuse the SB05 owner key or encryption key. Register the new Worker's `/api/forma/callback` URL in the Autodesk application. The application must be authorised for the M1 account/project.

Publish the separate Worker with `npx wrangler deploy`, then initialise owner access using the private expiring setup link, choose a personal code at `/admin/code`, and connect Autodesk at `/admin`. Set `FORMA_SYNC_ENABLED=true` once setup is confirmed. The owner can upload the prepared baseline JSON in the owner controls. Credentials and tokens remain on Cloudflare, not GitHub Pages.

The GitHub Actions workflow builds and publishes Pages from `main`. Set Pages source to GitHub Actions. Frontend and backend use separate M1 addresses; SB05 is unchanged. Public viewers can refresh shared data. Only the owner can change the baseline or Autodesk connection.

## Availability rules

- Each required baseline record represents one expected deliverable. `names` lists exact accepted alternative filenames (case-insensitive). Multiple records represent multiple required deliverables. Optional `folderId` disambiguates files with the same name.
- Explicit `required:false` means not required. An undefined asset/discipline combination is not checked, never automatically not required.
- RVT, IFC, NWC and NWD are model formats. A PDF/CAD drawing does not satisfy a model requirement.
- Recursive folder scans follow pagination. A complete scan replaces the snapshot atomically; failed scans retain the prior completed snapshot and its timestamp. Missing is never inferred from a partial scan.
- Available means all expected deliverables are present, not approved or design-complete. Native and exchange deliverables can be separate requirements when both are needed.
- Folder checks are capped at 20 Autodesk reads per invocation; reviews have their own 20-read batch. The minute Worker schedule advances unfinished work. New scans are throttled to five minutes, manual starts to one minute. These settings target the free plan and do not guarantee zero cost if Cloudflare changes its limits or the account enables billing.

## API references

Autodesk [Data Management](https://aps.autodesk.com/data-management-api), [data browsing tutorial](https://get-started.aps.autodesk.com/tutorials/hubs-browser/data), and [folder contents endpoint](https://aps.autodesk.com/en/docs/data/v2/reference/http/projects-project_id-folders-folder_id-contents-GET/). Review synchronisation and owner-code authentication are adapted from the existing SB05 implementation.

Status: Cloudflare backend deployed. The frontend is prepared for GitHub Pages. Autodesk connection and baseline matching remain pending; empty states are intentional until verified.

