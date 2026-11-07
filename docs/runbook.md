# Runbook

What to do when something breaks in production. Setup and releases are in [deployment.md](deployment.md).

Production runs on Vercel (app), Supabase (Postgres), Cloudflare R2 (receipt files), Google Gemini (OCR) and Resend
(email). The Docker image runs the same app elsewhere; where steps differ, both are given.

## First five minutes

1. Check health:

   ```bash
   curl -s https://<domain>/api/health        # liveness: {"ok":true,"commit":"abc1234"}
   curl -s https://<domain>/api/health/ready  # readiness: database and storage
   ```

   `/api/health/ready` answers 503 when a check fails, with `checks.database` and `checks.storage` set to `ok`,
   `down` or `not_configured`. Each check has a 2 second timeout. Results are cached for 5 seconds per instance.
   Storage counts as up when the bucket answers a HEAD for `health/probe` with 200 or 404; on AWS S3 the token needs
   `s3:ListBucket` for a missing key to return 404.

2. Check the commit. `commit` in the health response is the short SHA of the running build (from
   `VERCEL_GIT_COMMIT_SHA`, or `GIT_COMMIT_SHA` on Docker). Compare it with the last merge to `main`. If the problem
   started with that deploy, roll back first and investigate after (see [Rollback](#rollback)).

3. Read the logs. Every request writes one JSON line to stdout (`apps/web/lib/log.ts`) with `event`, `outcome`,
   `status_code`, `request_id` and `error`.
   - Vercel: Project, Logs. Filter by `level:error` or by event name. Runtime logs are kept 1 hour on Hobby.
   - Docker: `docker logs <container> --since 30m | grep '"level":"error"'`.

   Events worth searching for:

   | Event                               | Means                                                              |
   | ----------------------------------- | ------------------------------------------------------------------ |
   | `receipt.upload`, `receipt.retry`   | One upload or retry; `error.type` and `ocr.kind` say why it failed |
   | `receipt.extract.background`        | A queued extraction finished or failed                             |
   | `health.not_ready`                  | A readiness check failed (logged once per fresh check)             |
   | `email.send_failed`                 | Resend rejected or could not be reached                            |
   | `auth.email_rate_limited`           | An address hit 3 reset or verification emails in an hour           |
   | `csp.violation`                     | The report-only CSP would have blocked something                   |
   | `http.client_ip_unresolved`         | Rate limits can't see client IPs; check `TRUSTED_*` settings       |
   | `route.failure`, `app.render_error` | Unhandled server errors                                            |

## Incidents

### Site down

1. `curl -sI https://<domain>/`. A Vercel error page or DNS failure means the platform, not the app: check
   <https://www.vercel-status.com> and the domain's DNS.
2. If `/api/health` fails too, check the latest deployment in Vercel. A failed build leaves the previous one live; a
   bad one that went live needs a [rollback](#rollback).
3. On Hobby, exceeding an included limit pauses the feature for up to 30 days. Check Vercel, Usage.

### OCR provider down (Gemini errors or 429s)

Symptoms: uploads end as failed, `receipt.upload` events with `error.type: "OcrError"` and `ocr.kind` such as
`rate-limited`, `timeout` or `provider-error`.

1. Check <https://aistudio.google.com/status> and the Gemini project's quota page.
2. In **Admin, Settings**, change the OCR model chain to a model that is answering, or put a lighter model first.
   This takes effect on the next upload without a deploy.
3. For a billing problem (key suspended, spend cap reached), fix it in Google Cloud Billing. A free-tier key must
   not be used in production.
4. Failed receipts are kept and can be retried by users once the provider is back. The first 5 failed reads a day
   per user don't count against their quota.

### Database down or paused

Symptoms: `/api/health/ready` returns `"database":"down"`, pages fail, `DbError` in logs.

1. Open the Supabase project. A Free project is paused after a week without activity: restore it from the
   dashboard. Check <https://status.supabase.com>.
2. Check the pooler: too many connections shows up as connection errors. The app opens at most 5 per instance
   (`DATABASE_POOL_MAX`).
3. If the password was changed, update `DATABASE_URL` in Vercel and redeploy.
4. If data is damaged, restore from backup (see [Rollback](#rollback)).

### Storage down

Symptoms: `"storage":"down"`, uploads fail with `StorageError`, receipt images don't load.

1. Check <https://www.cloudflarestatus.com> (R2) or the provider's status page.
2. Check the bucket and token in the Cloudflare dashboard: the token may have expired or lost access to the bucket.
3. Receipt data stays readable without storage; only uploads and images are affected. Nothing to do in the app until
   the store is back.

### Email down

Symptoms: `email.send_failed` in logs; in production, sign-up, password reset and invitations return an error
because an undelivered email fails the request.

1. Check <https://resend-status.com> and the Resend dashboard (domain verification, API key, daily limit). Resend
   Free allows 100 emails a day.
2. If the key was revoked, create a new one and update `RESEND_API_KEY`.
3. Many `auth.email_rate_limited` events for one address are someone requesting emails for it repeatedly; the cap
   already stops delivery.

### Quota abuse or a cost spike

Symptoms: OCR spend rising, one user or workspace uploading far more than usual.

1. Find the source in **Admin, Overview**, or query the usage ledger:

   ```sql
   select user_id, organization_id, count(*) as calls, sum(cost_micro_usd::bigint) / 1e6 as usd
   from ocr_calls
   where created_at > now() - interval '1 day'
   group by 1, 2 order by usd desc nulls last limit 20;
   ```

2. Ban the account in **Admin, Users**. Banning revokes its sessions.
3. Set or lower `OCR_DAILY_CAP` and redeploy. It counts OCR rounds per UTC day across all users: each upload or
   retry is one round, and each provider attempt within a round counts too. Lower plan limits in
   **Admin, Settings** for a quicker change.
4. Set a Gemini project spend cap and a Google Cloud budget alert if they aren't already.

### Leaked secret

1. Rotate it now, using the [table below](#secret-rotation). Rotate first, investigate after.
2. Redeploy so every instance picks up the new value.
3. Check what the secret could reach: Supabase logs for unknown clients, R2 and Gemini usage, Resend sends, GitHub
   Actions runs and Vercel deployments.
4. If the leak was in git, removing the commit doesn't help: the value must be rotated. Note it in the
   incident notes.

### Compromised user account

1. **Admin, Users**, open the user: revoke their sessions, ban if needed.
2. Check **Admin, Audit log** for admin actions in the same period.
3. Tell the user to reset their password once the account is safe.

### Disable the service worker

Use this when the service worker itself is the problem: pages stuck on the offline page, a broken share target, or
anything that looks cached when it should not be.

1. Replace the worker with the kill switch and deploy:

   ```bash
   cp apps/web/public/sw-killswitch.js apps/web/public/sw.js
   ```

   Browsers check `/sw.js` on their next visit (it is served with `Cache-Control: no-cache`). The kill switch
   installs at once, deletes every `receiptocr-*` cache (the offline page and any shared files), unregisters itself
   and reloads open tabs, which then load straight from the network.

2. Leave it deployed for a few weeks. Devices that have not visited since still run the old worker until they do.
   The app keeps registering `/sw.js` under `/app`, so each visit installs the kill switch and it removes itself
   again; that costs one small request and does no harm.

**Deleting `sw.js` is not enough.** When the script returns 404 the browser keeps the installed worker running; it
only replaces a worker with a new script that loads.

Optionally, for a faster clean-up on browsers that support it, send `Clear-Site-Data: "storage"` for one release, for
example from the `headers()` list in `apps/web/next.config.ts` on `/app/:path*`. It removes service workers and Cache
Storage, and also local storage (the install prompt's dismissal), but not cookies, so nobody is signed out. Safari
support is partial, so use it with the kill switch, not instead of it.

**Warning:** `Clear-Site-Data` runs on every response that carries it, so a visitor loses their local storage and
caches on each page load while it is deployed, and a share waiting in Cache Storage is deleted. Send it for one
release only, then remove it.

To turn the worker back on, restore `public/sw.js` from git, bump `VERSION` in it and deploy.

## Rollback

- **Code on Vercel:** Deployments, pick the last good production deployment, **Promote to Production**. Then revert
  the bad commit on `main` with `git revert` so the next deploy doesn't bring it back.
- **Code on Docker:** run the previous image tag.
- **Database:** migrations only go forward, and old code runs against the newer schema, so a code rollback normally
  needs nothing else. If a migration damaged data, restore the backup taken before the release (deployment.md,
  Every release, step 3) into a new database, check it, then point `DATABASE_URL` at it.

## Secret rotation

Names only; values live in Vercel (Production environment), the container environment, or GitHub Actions secrets.
After any rotation, redeploy and run the smoke test from [deployment.md](deployment.md#7-check-it-works). Rotate all of
them once a year, and at once when someone with access leaves.

| Secret                                                                                                                   | Where it lives                                  | How to rotate                                                                                             | What breaks                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`                                                                              | Vercel / container                              | Versioned: see [Rotating the auth secret](deployment.md#rotating-the-auth-secret)                         | Nothing if versioned; changing the current version signs everyone out                          |
| `DATABASE_URL`, `DIRECT_URL`                                                                                             | Vercel / container; your machine for migrations | Supabase, Database settings, reset the database password; update both URLs                                | Every instance until redeployed with the new URL                                               |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                                                               | Vercel / container                              | Cloudflare R2, Manage API tokens: create a new token for the bucket, deploy it, then delete the old one   | Uploads and images until redeployed; signed image URLs already issued expire within 10 minutes |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                                           | Vercel / container                              | Google AI Studio or Cloud Console, API keys: create a key in the paid project, deploy, delete the old key | OCR until redeployed                                                                           |
| `RESEND_API_KEY`                                                                                                         | Vercel / container                              | Resend, API Keys: create a sending key, deploy, revoke the old one                                        | Account emails until redeployed                                                                |
| `GOOGLE_CLIENT_SECRET`                                                                                                   | Vercel / container                              | Google Cloud Console, Credentials, the OAuth client: add a secret, deploy, disable the old one            | Google sign-ins in progress during the switch                                                  |
| `GITHUB_CLIENT_SECRET`                                                                                                   | Vercel / container                              | GitHub, Developer settings, OAuth Apps: generate a new secret, deploy, delete the old one                 | GitHub sign-ins in progress during the switch                                                  |
| `VERCEL_TOKEN`                                                                                                           | GitHub Actions secret                           | Vercel, Account settings, Tokens: create a token, update the repository secret, delete the old token      | Deploys from Actions until updated                                                             |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                                                                                     | GitHub Actions secret                           | Identifiers, not credentials; change only when the project moves                                          | Nothing                                                                                        |
| `TURNSTILE_SECRET_KEY` (site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined at build time: changing it needs a rebuild) | Vercel / container                              | Cloudflare, Turnstile, the widget: rotate the secret key, deploy; rebuild if the site key changed         | Protected forms until redeployed                                                               |

Not secrets, but worth checking after a leak: `ADMIN_EMAILS` (who becomes admin on sign-up) and `SUPPORT_EMAIL`.
