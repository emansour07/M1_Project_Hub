# Team progress updates

The dashboard links to **Update progress** and **Request team updates** in Model progress → Tracker. The form at `/progress-update` lists each approved Autodesk editor's assigned assets/disciplines. It collects delivery status, the current visible LOG/LOI stage, overall completion, target date and blocker/comment. Overall completion is a team estimate, separate from MIDP approval-based engineering completeness.

## Owner setup

1. Open `/admin/progress-requests` using owner sign-in.
2. Open **Manage approved editor emails and scope**. Add each lead's exact verified Autodesk email; assign assets, disciplines and editable fields. Include `overallCompletion`, `deliveryStatus`, `targetDate`, `blocker` and the current LOG/LOI column keys. Existing permissions are not widened automatically.
3. Select the recipients, edit the request text and save. Preview the form. Teams submit several changed models together; pending updates use the existing owner review and Excel publication process.
4. After IT connects the sender, use **Send request now** for the saved recipient list. Manual sending works while the automatic schedule is paused.
5. Uncheck **Pause automatic weekly requests** and save to enable Wednesday 14:00 Asia/Dubai requests. The scheduler queues once per recipient each Wednesday, on the first successful tick at or after 14:00 that day. Leads without assigned models are skipped.

The default is paused with no selected recipients. A forwarding recipient cannot edit models without an approved Autodesk identity. Submissions are private drafts; submitting does not upload a new ACC Excel version. Existing draft approval remains with the owner. Reloading the form shows published tracker values and pending-submission markers, rather than silently treating drafts as published progress.

## Interim Cloudflare mailbox connection

Email is **not connected by publishing this code**. IT must authorize sending from `eslam.mansour@arx.ing`.

For an Exchange Online mailbox, the connector uses server-side Microsoft Graph client credentials. IT should register a dedicated application and grant the Exchange **Application Mail.Send** role scoped only to that mailbox using [Exchange application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac). Verify the scope using Microsoft's authorization test. Avoid an additional tenant-wide Entra Mail.Send grant: permissions are additive and such a grant would bypass the intended mailbox restriction.

Set these Worker secrets privately through Cloudflare or Wrangler secret input; do not commit them or put them into frontend configuration:

- `M1_MAIL_TENANT_ID`
- `M1_MAIL_CLIENT_ID`
- `M1_MAIL_CLIENT_SECRET`

Set `M1_PROGRESS_MAIL_ENABLED=true` only after IT verifies the mailbox authorization. Optional `M1_PROGRESS_FORM_ORIGIN` defaults to `https://m1-project-api.eslam-mansour.workers.dev`. Keep HTTPS and the same deployed form host. The existing Worker minute cron handles queued messages in batches of eight. No paid email service is required by this implementation; IT must confirm the company's existing Microsoft licensing and access policy.

The connector calls [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) once per recipient. A 202 response is shown as **Accepted by email service**, not as confirmed delivery. Errors or uncertain sends are not automatically retried; inspect Sent Items/mail logs before requesting another send. Changing recipients/settings cancels queued requests created under the old settings. Pausing cancels queued weekly requests. Already accepted messages cannot be recalled by pausing.

## Company Django deployment

The same form and controls are included. Configure the existing approved company SMTP relay using `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` as appropriate to IT's supported relay. The current configuration supports STARTTLS; IT should extend `m1server/settings.py` if its relay requires implicit SSL. Set `M1_MAIL_ENABLED=true` only after testing the sender. Set `PUBLIC_URL` to the internal HTTPS dashboard URL and run `manage.py run_jobs` once per minute with the company scheduler.

Do not run both hosts' weekly schedules during migration. Pause Cloudflare requests, transfer the approved editor scopes/settings through the controlled migration process, verify the internal form and mailbox, then enable the internal schedule. Secret values and editor/request data are deployment data, not public GitHub files.

The owner can use the form immediately without a mail connection and share its link with approved editors. Automated and manual email delivery remain unavailable until IT connects the sender.
