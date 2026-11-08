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

3. Read the logs. Every unit of work writes one JSON line ([wide events](architecture/flows/observability.md)): each
   API request, each `/app` and `/admin` page render, each job attempt and each queue tick. Every line has
   `timestamp`, `level`, `event`, `outcome` and the deployment fields (`version` is the commit); requests add
   `request_id`, `route`, `status_code` and `duration_ms`, failures add `error` (`type`, `kind`, `class`, `code`, never a
   message).
   - Vercel: Project, Logs. Filter by `level:error` or by event name. Runtime logs are kept 1 hour on Hobby.
   - Docker: `docker logs <container> --since 30m | grep '"level":"error"'`.
   - With `LOG_SAMPLE_RATE` below 1, fast successful polls, page renders and idle ticks are sampled (they carry
     `sample_rate`). Errors, slow units (`LOG_SLOW_MS`) and anything that called a model are always kept.

   **Find one request.** API responses carry the request id in the `x-request-id` header. Search for it:
   `grep '"request_id":"<id>"'`. The request's own event and every `job.attempt` it started share that id.
   Caveat: the id is per request, not per user action. A page render's id (`/app`, `/admin`) is set by `proxy.ts` and is
   not returned to the browser, so a render is found by `route`, `user_id` and time instead. A client-sent
   `x-request-id` is never trusted: API routes and error reports outside `/app` and `/admin` make their own.

   **Find a receipt's history.** Search for `"receipt_id":"<id>"`: the upload or retry request, each `job.attempt`
   (`attempt`, `round`, `queue.outcome`, `error.kind`, `ocr.model`) and the polls. `"job_id":"<id>"` narrows it to one
   job.

   Events worth searching for:

   | Event                                 | Means                                                                                          |
   | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
   | `receipt.upload`, `receipt.retry`     | One upload or retry; `error.type` and `error.kind` say why it failed                           |
   | `job.attempt`                         | One job attempt (was `job.run`); `queue.outcome` is `succeeded`, `retry`, `dead`…              |
   | `job.tick`                            | One queue drain: what it claimed and reaped; `notices` lists `jobs.*_failed`                   |
   | `page.render` with `level:error`      | A server render failed; `error.digest` matches the error page the user saw                     |
   | `request.error`                       | Next.js caught an unhandled render, route or action error                                      |
   | `route.failure`                       | A server action's core call failed with a 5xx or a defect                                      |
   | `health.not_ready`                    | A readiness check failed (logged once per fresh check)                                         |
   | `email.send_failed`                   | Resend rejected or could not be reached; `error.kind` is Resend's error name                   |
   | `auth.email_rate_limited`             | An address hit 3 emails of one `kind` (reset, verification, deletion...) an hour               |
   | `auth.sign_in_locked`                 | An address reached 10 failed sign-ins in 15 minutes; sign-in answers 429 until the window ends |
   | `user.delete_requested`               | A deletion link was emailed; `user.deleted` follows only if the link was used                  |
   | `auth.step_up_required`               | A delete or email change was refused until the user signs in again (`action`)                  |
   | `auth.notice_sent`, `delivered:false` | A "password changed" notice did not go out; the change itself went through                     |
   | `csp.violation`                       | The report-only CSP would have blocked something                                               |
   | `http.client_ip_unresolved`           | Rate limits can't see client IPs; check `TRUSTED_*` settings                                   |
   | an event with `dropped_fields`        | Code tried to log a field the schema doesn't allow; fix the call site                          |

## Incidents

### Site down

1. `curl -sI https://<domain>/`. A Vercel error page or DNS failure means the platform, not the app: check
   <https://www.vercel-status.com> and the domain's DNS.
2. If `/api/health` fails too, check the latest deployment in Vercel. A failed build leaves the previous one live; a
   bad one that went live needs a [rollback](#rollback).
3. On Hobby, exceeding an included limit pauses the feature for up to 30 days. Check Vercel, Usage.

### OCR provider down (Gemini errors or 429s)

Symptoms: uploads end as failed, `job.attempt` events with `error.type: "OcrError"` and `error.kind` such as
`rate-limited`, `timeout` or `provider-error`.

Quick check: in **Admin, Settings, Connections** press **Check now**. It says whether the key is accepted and the models are visible, or the key is rejected, rate-limited or unreachable. It does not check billing or credit, so a key that shows Working can still fail for lack of credit; check the provider's usage page.

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
4. If data is damaged, restore from backup (see [Backups, Restore](#restore)).

### Storage down

Symptoms: `"storage":"down"`, uploads fail with `StorageError`, receipt images don't load.

Quick check: **Admin, Settings, Connections, Check now** writes, reads and deletes a small object under `_health/` and tells you which step failed.

1. Check <https://www.cloudflarestatus.com> (R2) or the provider's status page.
2. Check the bucket and token in the Cloudflare dashboard: the token may have expired or lost access to the bucket.
3. Receipt data stays readable without storage; only uploads and images are affected. Nothing to do in the app until
   the store is back.

### Email down

Symptoms: `email.send_failed` in logs; in production, sign-up, password reset and invitations return an error
because an undelivered email fails the request.

Quick check: **Admin, Settings, Connections, Send test email** sends one message to your own address (3 per hour) and says sent, not configured or failed.

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

### Jobs stuck or dead

Symptoms: receipts stay "processing", or the **Dead, last 24 hours** tile on **Admin, Operations** is above zero.

1. Open **Admin, Jobs** (filter by state, kind or user). The detail page shows each attempt and its error kind.
2. Dead because of a provider outage that has passed: **Re-run**. It reads the receipt again in its original round, so
   the user is not charged, but it still counts against `OCR_DAILY_CAP` and is audited (`job.rerun`).
3. Not wanted any more: **Cancel** a queued job. To stop new work while you fix something, **Pause** the queue or one
   kind from Operations; **Resume** when done. A provider cooldown clears itself, or clear it by hand.
4. Every action appears in **Admin, Audit log** (`job.*`). A user who has retried since is refused: the retry already
   re-read it.

Past about 1M `jobs` rows, build new `jobs` indexes by hand with `CREATE INDEX CONCURRENTLY` and keep a no-op migration
so the journal stays in step.

### Migration failed

A **Database Migration** run is red. Production still runs the previous code: the deploy for a release with
migrations only happens by hand, after both migrations succeed. If staging failed, production's schema wasn't
touched; if production failed, staging already has the migration.

1. Open the failed run and find the failing step.
   - **Require main** (preflight) failed: the run wasn't started from `main`. Start it again from `main`.
   - **Require staging on this commit** (preflight, `production-db` only) failed: the newest successful `staging-db`
     run has different migrations from this commit, or none was found. Run **Database Migration** for `staging-db` on
     the current `main`, check staging, then run `production-db` again.
   - **Check the secret is set** failed: the environment or its `DIRECT_URL` secret is missing or malformed
     (Settings → Environments; see deployment.md, Migrations). The message never includes the URL.
   - **Apply migrations** failed: read the Postgres error. If the log shows only the `drizzle-kit` spinner and
     `exit code 1` with no error, it couldn't connect: check the database is up and not paused, the session pooler
     (port 5432) is reachable, and the password in `DIRECT_URL` is current.
2. Check what was applied. `drizzle-kit migrate` applies all pending files in **one transaction**, so a failed run
   rolls back the whole run: that database is exactly as it was before. In the Supabase SQL editor:

   ```sql
   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;
   ```

3. Fix the cause:
   - **Connection or timeout** (database paused, pooler down, password rotated): fix it, then go to step 4.
   - **The migration itself is wrong** (a constraint existing rows break, a lock timeout): open a PR that fixes it
     and merge it. If staging already applied the file (only production failed), don't edit it, because staging
     would never re-run it: add a new migration that works on both instead.
   - **Data damaged:** restore the backup taken before the migration (deployment.md, Every release, step 3).
4. Retry: Actions → **Database Migration** → Run workflow on `main`, `staging-db` first, then `production-db`
   (approve it). Then run **Vercel Production Deployment** by hand on `main`.

Start one run per database at a time. GitHub keeps one pending run per concurrency group, so a second run started
while the first waits for approval cancels the waiting one; re-run it if that happens.

Don't run `db:migrate` from a laptop against production unless Actions is down.

### Deploy skipped after a merge

The **Vercel Production Deployment** run is green but `deploy-production` was skipped, and the summary says why:

- **"This release adds migrations"**: expected. Follow deployment.md, Every release, steps 6 to 8.
- **"Can't find the last production deploy"**: no run of the workflow on `main` (among the last 50) has a successful
  `deploy-production` job, or the lookup failed. Run **Database Migration** for `staging-db`, then `production-db` (a
  no-op when up to date), then run the workflow by hand on `main`; that deploy becomes the new reference.

### Manual deploy refused

A manual **Vercel Production Deployment** run is red at `gate`, with "Production deploy refused" in the summary:

- **"CI hasn't passed"**: wait for CI on that `main` commit, or fix it. Manual deploys only ship commits CI passed.
- **"main has migrations production hasn't run"** or **"Can't find a successful production-db migration"**: run
  **Database Migration** for `staging-db`, then `production-db` on the current `main`, then deploy again.
- **"Can't check CI"** or **"Can't compare"**: the GitHub API or the history lookup failed; nothing deployed. Re-run.

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
  Every release, step 3), or the last nightly one, into a new database ([Restore](#restore)), check it, then point
  `DATABASE_URL` and `DIRECT_URL` at it.

## Backups

**Database Backup** ([`db-backup.yml`](../.github/workflows/db-backup.yml), running
[`scripts/db-backup.sh`](../scripts/db-backup.sh)) backs up production every night at 21:15 UTC (03:00 in Kathmandu),
and can be started by hand from `main`:

1. `pg_dump` (custom format, zstd) of the schemas `public` (every app table, Better Auth's included) and `drizzle`
   (the migrations journal), as the read-only `backup_reader` role. Supabase's own schemas (`auth`, `storage`,
   `vault`, `cron`, `net`...) are left out: the app doesn't use `auth` or `storage`, and the pg_cron job and its
   Vault secret are recreated from [production-environment.md, step 8](production-environment.md#8-queue-drain-cron).
   Row counts for every table are read in the same snapshot as the dump.
2. Encrypted with [age](https://age-encryption.org) to the owner's public key, so neither R2 nor GitHub holds
   readable data. Only the owner's offline key can decrypt a stored backup.
3. Uploaded to the R2 bucket `receipt-ocr-backups` as `daily/<YYYY-MM-DD>/receipt-ocr-<time>-<commit>.dump.age`.
   On the 1st of the month a second copy goes under `monthly/<YYYY-MM>/`.
4. **Restore drill**, every run: the file is downloaded again, decrypted and restored into a throwaway Postgres
   container in the job, and the run fails unless every table's row count matches the source and the migrations
   journal isn't empty. A dump with broken foreign keys fails here too.
5. A `.manifest.json` is uploaded next to the dump only after the drill passes: table row counts, migration count,
   Postgres version, sizes and sha256 of the dump and of the encrypted file. **A dump without a manifest did not
   pass its drill; don't rely on it.**

Retention (R2 lifecycle rules): `daily/` 30 days, `monthly/` 180 days. A red run emails whoever last changed the
`schedule` line in the workflow. The run's summary says the object name and sizes; row counts stay out of the logs,
because this repository's Actions logs are public.

**How the drill decrypts without the owner's key.** Each run makes a one-off age key and encrypts to it as well as
to the owner's key. The drill decrypts the downloaded file with it, then deletes it; its private half never leaves
the runner's temp directory and is never stored. So the drill checks the stored file end to end without the owner's
private key being in GitHub. What it can't check is that the owner's key itself still decrypts: that is the
[monthly check](#monthly-check-with-the-owners-key).

What is **not** in the backup: receipt images and PDFs in the receipts bucket (R2 has no versioning; a deleted file
is gone), Supabase roles and settings, and the pg_cron job and Vault secret.

### One-time setup

The owner does these; nothing here runs automatically.

1. **Check the Postgres version.** In the Supabase SQL editor, `show server_version;`. The backup uses pg_dump 17
   (`BACKUP_PG_IMAGE` in `scripts/db-backup.sh`) and stops with a clear error if the server's major version differs.
   If it says 18, pin the script to a `postgres:18` image digest first.

2. **Create the `backup_reader` role.** Make a password with `openssl rand -hex 32` and keep it in the password
   manager. Run [`scripts/db-backup-role.sql`](../scripts/db-backup-role.sql) in the SQL editor (or through the
   Management API) with `REPLACE_WITH_PASSWORD` replaced:

   ```sql
   create role backup_reader with login password 'REPLACE_WITH_PASSWORD' bypassrls connection limit 3;
   alter role backup_reader set default_transaction_read_only = on;
   grant usage on schema public, drizzle to backup_reader;
   grant select on all tables in schema public, drizzle to backup_reader;
   grant select on all sequences in schema public, drizzle to backup_reader;
   alter default privileges for role postgres in schema public, drizzle grant select on tables to backup_reader;
   alter default privileges for role postgres in schema public, drizzle grant select on sequences to backup_reader;
   ```

   Why `bypassrls`: every app table has RLS on with no policies. pg_dump turns row security off and stops with
   "query would be affected by row-level security policy" for a role that RLS would filter, so without it the
   backup fails rather than missing rows. Supabase's `postgres` role has `bypassrls` and can grant it. The role
   can read only `public` and `drizzle` (not `auth`, `storage` or `vault`), sessions are read-only by default, and
   default privileges cover tables added by later migrations. Check:

   ```sql
   select rolcanlogin, rolbypassrls, rolsuper, rolconnlimit from pg_roles where rolname = 'backup_reader';
   -- expect: t, t, f, 3
   select count(*) from information_schema.role_table_grants
     where grantee = 'backup_reader' and privilege_type <> 'SELECT';
   -- expect: 0
   ```

   If `bypassrls` is refused, stop: don't add a policy or use the `postgres` login instead without deciding it.

3. **The connection string** for `BACKUP_DATABASE_URL` uses the **session pooler** (port 5432; the direct host is
   IPv6 only and GitHub runners are IPv4; the transaction pooler can't hold the snapshot the dump and counts share),
   with the pooler's `role.project-ref` user:

   ```text
   postgresql://backup_reader.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require
   ```

   Take the host from Supabase, Connect, Session pooler.

4. **R2 bucket and token.** In Cloudflare, R2: create the bucket `receipt-ocr-backups` (separate from the receipts
   bucket). In its Settings, Object lifecycle rules, add: prefix `daily/`, delete after 30 days; prefix
   `monthly/`, delete after 180 days; and abort incomplete multipart uploads after 1 day. Then Manage API tokens,
   create a token with **Object Read & Write** applied to `receipt-ocr-backups` only. Note the Access Key ID, the
   Secret Access Key and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.
   Optional: a bucket lock rule on `daily/` for 7 days, so a leaked token can't delete the last week.

5. **The age key, on your own machine** (not a Codespace). Install age (`brew install age`, `apt install age`, or
   the [release](https://github.com/FiloSottile/age/releases)) and run:

   ```bash
   age-keygen -o receipt-ocr-backup.key   # prints "Public key: age1..."
   ```

   Save the whole file (it holds the private key) in the password manager, plus one offline copy (printed or on a
   USB stick kept safe). Then delete the file. The private key never goes into GitHub, Vercel, R2 or a Codespace.
   Losing it means every backup is unreadable. To add a second holder later, put their public key on a second
   line of the variable below.

6. **GitHub environment.** Settings, Environments, New environment `db-backup`. Deployment branches: selected
   branches, `main` only. No required reviewers (a nightly run can't wait for approval). Then:

   ```bash
   gh secret set BACKUP_DATABASE_URL --env db-backup          # paste the URL from step 3
   gh secret set BACKUP_R2_ENDPOINT --env db-backup           # https://<account-id>.r2.cloudflarestorage.com
   gh secret set BACKUP_R2_BUCKET --env db-backup --body receipt-ocr-backups
   gh secret set BACKUP_R2_ACCESS_KEY_ID --env db-backup
   gh secret set BACKUP_R2_SECRET_ACCESS_KEY --env db-backup
   gh variable set BACKUP_AGE_RECIPIENT --env db-backup --body 'age1...'   # public key, not a secret
   ```

   The recipient is a variable so its value stays visible for checking; it is a public key.

7. **First run.** Actions, **Database Backup**, Run workflow on `main`. Green means the drill passed. Then do the
   [monthly check](#monthly-check-with-the-owners-key) once, to prove your key decrypts what the job stored.

8. **Alerts.** Scheduled-run failures email the person who last changed the workflow's `schedule` line; make sure
   that is the owner's account and that Settings, Notifications, Actions sends failed runs by email. GitHub disables
   schedules in a public repository after 60 days without activity (it emails first); re-enable it from the
   Actions tab.

### Monthly check with the owner's key

On the 1st of each month, on your own machine, about 10 minutes. It proves the offline key still decrypts and the
newest backup restores.

1. Download the newest `daily/<date>/*.dump.age` and its `.manifest.json` from the bucket in the Cloudflare
   dashboard.
2. Decrypt and restore into a throwaway local Postgres 17:

   ```bash
   age -d -i receipt-ocr-backup.key -o backup.dump receipt-ocr-*.dump.age   # key file from the password manager
   sha256sum backup.dump                                                   # equals .dump.sha256 in the manifest
   docker run -d --rm --name restore-check -e POSTGRES_PASSWORD=check \
     postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
   docker cp backup.dump restore-check:/tmp/backup.dump
   docker exec restore-check sh -c '
     until pg_isready -q -h 127.0.0.1 -U postgres; do sleep 1; done
     pg_restore -l /tmp/backup.dump | grep -vE "^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public " >/tmp/list
     pg_restore -U postgres -d postgres --use-list=/tmp/list --single-transaction --exit-on-error \
       --no-owner --no-privileges /tmp/backup.dump'
   docker exec restore-check psql -U postgres -c 'select count(*) from "user"' -c 'select count(*) from receipts'
   jq '.tables["public.user"], .tables["public.receipts"]' receipt-ocr-*.manifest.json   # same numbers
   ```

3. Clean up: `docker rm -f restore-check`, then delete `backup.dump`, the key file and the downloads.

### Restore

Every restore uses the steps of the monthly check: decrypt on the owner's machine, then `pg_restore` with the list
that skips `CREATE SCHEMA public` and with `--single-transaction --exit-on-error --no-owner --no-privileges`. The
target must have no app tables and no `drizzle` schema. Restoring as `postgres` on Supabase, the new tables get
Supabase's default grants, as migrations would give them. Afterwards, run `scripts/db-backup-role.sql` again on that
database if it will be backed up.

- **Locally:** as the monthly check, or into the compose Postgres's empty database.
- **Staging:** drop the app tables first (the pre-check and reset SQL in
  [deployment.md, Release notes](deployment.md#squashed-baseline-and-row-level-security-2026-11-07), with today's
  table list from `select tablename from pg_tables where schemaname = 'public'`), then
  `pg_restore --dbname="$DIRECT_URL" ...` with staging's `DIRECT_URL`. Staging then holds production data: treat it
  as production.
- **Production, in an emergency, only with the owner's go.** Everything written since the backup (up to a day) is
  lost, so first decide whether that is worse than the damage. Prefer a **new Supabase project**: restore there,
  check the counts against the manifest, sign in on a preview pointed at it, then change `DATABASE_URL` and
  `DIRECT_URL` in Vercel and redeploy; the damaged database stays as it is for investigation. Recreate the pg_cron
  job and Vault secret ([production-environment.md, step 8](production-environment.md#8-queue-drain-cron)) and the
  `backup_reader` role there. Restoring over the live database instead means the reset SQL first, which is
  destructive: take a fresh backup (run **Database Backup**) before it.

## Secret rotation

Names only; values live in Vercel (Production environment), the container environment, or GitHub Actions secrets.
After any rotation, redeploy and run the smoke test from [deployment.md](deployment.md#7-check-it-works). Rotate all of
them once a year, and at once when someone with access leaves.

| Secret                                                                                                                   | Where it lives                                                                                    | How to rotate                                                                                                                                                | What breaks                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`                                                                              | Vercel / container                                                                                | Versioned: see [Rotating the auth secret](deployment.md#rotating-the-auth-secret)                                                                            | Nothing if versioned; changing the current version signs everyone out                          |
| `DATABASE_URL`, `DIRECT_URL`                                                                                             | Vercel / container; `DIRECT_URL` also in the `staging-db` and `production-db` GitHub environments | Supabase, Database settings, reset the database password; update both URLs, in Vercel and the GitHub environment                                             | Every instance until redeployed with the new URL                                               |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                                                               | Vercel / container                                                                                | Cloudflare R2, Manage API tokens: create a new token for the bucket, deploy it, then delete the old one                                                      | Uploads and images until redeployed; signed image URLs already issued expire within 10 minutes |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                                           | Vercel / container                                                                                | Google AI Studio or Cloud Console, API keys: create a key in the paid project, deploy, delete the old key                                                    | OCR until redeployed                                                                           |
| `ANTHROPIC_API_KEY`                                                                                                      | Vercel / container                                                                                | Anthropic Console, API keys: create a key in the same workspace (keep its spend limit), deploy, delete the old key                                           | Claude steps in the OCR chain until redeployed                                                 |
| `RESEND_API_KEY`                                                                                                         | Vercel / container                                                                                | Resend, API Keys: create a sending key, deploy, revoke the old one                                                                                           | Account emails until redeployed                                                                |
| `GOOGLE_CLIENT_SECRET`                                                                                                   | Vercel / container                                                                                | Google Cloud Console, Credentials, the OAuth client: add a secret, deploy, disable the old one                                                               | Google sign-ins in progress during the switch                                                  |
| `GITHUB_CLIENT_SECRET`                                                                                                   | Vercel / container                                                                                | GitHub, Developer settings, OAuth Apps: generate a new secret, deploy, delete the old one                                                                    | GitHub sign-ins in progress during the switch                                                  |
| `BACKUP_DATABASE_URL`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`                                          | GitHub environment `db-backup`                                                                    | Database: `alter role backup_reader password '<new>'` and update the secret. R2: create a new bucket-scoped token, update both secrets, delete the old token | The next nightly backup, until updated                                                         |
| age backup key (private)                                                                                                 | Owner's password manager and offline copy; never in GitHub                                        | Make a new key, set `BACKUP_AGE_RECIPIENT` to its public key, keep the old private key until the last backup made with it has expired (180 days)             | Nothing; old backups still need the old key                                                    |
| `VERCEL_TOKEN`                                                                                                           | GitHub environment `vercel`                                                                       | Vercel, Account settings, Tokens: create a token, update the environment secret, delete the old token                                                        | Deploys from Actions until updated                                                             |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                                                                                     | GitHub environment `vercel`                                                                       | Identifiers, not credentials; change only when the project moves                                                                                             | Nothing                                                                                        |
| `TURNSTILE_SECRET_KEY` (site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined at build time: changing it needs a rebuild) | Vercel / container                                                                                | Cloudflare, Turnstile, the widget: rotate the secret key, deploy; rebuild if the site key changed                                                            | Protected forms until redeployed                                                               |

Not secrets, but worth checking after a leak: `ADMIN_EMAILS` (who becomes admin on sign-up) and `SUPPORT_EMAIL`.
