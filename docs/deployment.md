# Deployment

How to set up a new environment, and what to do on every release after that. Local development is in the
[README](../README.md).

Production runs on Vercel with Supabase Postgres and Cloudflare R2. The Docker image (`docker/Dockerfile.prod`) runs
the same app on Bun anywhere else.

## What you need

| Piece    | Production choice            | Alternatives                               |
| -------- | ---------------------------- | ------------------------------------------ |
| App host | Vercel                       | Any Docker host (`docker/Dockerfile.prod`) |
| Database | Supabase Postgres            | Any Postgres 15+                           |
| Storage  | Cloudflare R2                | AWS S3, RustFS, any S3-compatible store    |
| OCR      | Google Gemini API key        | —                                          |
| Email    | Resend                       | None: mail is logged instead of sent       |
| Sign-in  | Google and GitHub OAuth apps | Email and password only                    |

## First-time setup

### 1. Database

Create the Postgres database. On Supabase, note both connection strings:

- **Transaction pooler (port 6543)** for the app: `DATABASE_URL`.
- **Session pooler (port 5432)** for migrations: `DIRECT_URL`. Schema changes fail on the transaction pooler.

Once the GitHub environments below are set up, CI applies migrations on every push to `main` (see
[Migrations in CI](#migrations-in-ci)). For a brand-new database you can also apply them from your machine:

```bash
DIRECT_URL='<session pooler URL>' bun run db:migrate
```

`drizzle-kit` records what it applied in `drizzle.__drizzle_migrations`, so running it again only applies new files.

### 2. Storage

Create a private bucket (for example `receipt-ocr`) and an API token with read and write access to it. Receipt
images are served through short-lived signed URLs, so the bucket stays private.

### 3. OAuth apps (optional)

Each provider turns on only when both its ID and secret are set. Use these callback URLs:

- Google: `https://<your domain>/api/auth/callback/google`
- GitHub: `https://<your domain>/api/auth/callback/github`

### 4. Environment variables

Set these in Vercel (Project → Settings → Environment Variables, Production) or in the container's environment.
`apps/web/.env.example` explains each one.

| Variable                                   | Required          | Notes                                                                                                                                                                                                |
| ------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Yes               | Transaction pooler URL on Supabase.                                                                                                                                                                  |
| `DIRECT_URL`                               | For migrations    | Session pooler URL. Not needed by the running app; CI reads it from the `staging-db` and `production-db` GitHub environments, not from Vercel.                                                       |
| `BETTER_AUTH_SECRET`                       | Yes               | `openssl rand -base64 32`. See [Rotating the auth secret](#rotating-the-auth-secret).                                                                                                                |
| `BETTER_AUTH_SECRETS`                      | No                | Versioned secrets for rotation, current first: `2:<new>,1:<old>`.                                                                                                                                    |
| `BETTER_AUTH_URL`                          | Yes               | The exact origin users visit, e.g. `https://receiptocr.example.com`. Requests from any other host (such as a `*.vercel.app` alias) are refused. Leave it unset for Vercel previews.                  |
| `NEXT_PUBLIC_SITE_URL`                     | Yes               | Same origin. Used for canonical URLs, the sitemap and social cards.                                                                                                                                  |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | Yes               | For R2, `S3_REGION=auto`.                                                                                                                                                                            |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes               |                                                                                                                                                                                                      |
| `S3_FORCE_PATH_STYLE`                      | No                | `true` for RustFS and other self-hosted stores.                                                                                                                                                      |
| `GOOGLE_GENERATIVE_AI_API_KEY`             | Yes               | Gemini key.                                                                                                                                                                                          |
| `GEMINI_MODEL`                             | No                | First-run default model. After that, choose models in **Admin → Settings**.                                                                                                                          |
| `OCR_DAILY_CAP`                            | No                | Spend guard: OCR rounds per UTC day across all users (each upload or retry is one round, plus each provider attempt).                                                                                |
| `RESEND_API_KEY`, `EMAIL_FROM`             | Yes in production | Without them, verification and reset links are only logged.                                                                                                                                          |
| `SUPPORT_EMAIL`                            | Yes in production | Inbox for support-form messages.                                                                                                                                                                     |
| `ADMIN_EMAILS`                             | Recommended       | Comma-separated emails made admin when they sign up.                                                                                                                                                 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No                | Google sign-in.                                                                                                                                                                                      |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No                | GitHub sign-in.                                                                                                                                                                                      |
| `TRUSTED_IP_HEADERS`                       | Off Vercel only   | The header your proxy sets to the client IP, e.g. `x-forwarded-for`. The app refuses to start in production without it, because rate limits would otherwise share one bucket. Leave unset on Vercel. |
| `TRUSTED_PROXIES`                          | No                | Required if your proxy appends to that header rather than overwriting it (nginx's default). Otherwise every client shares one rate-limit bucket, and the app logs `http.client_ip_unresolved`.       |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`           | No                | Cloudflare Turnstile site key. Set with `TURNSTILE_SECRET_KEY` to turn bot protection on; see [Bot protection](#bot-protection-turnstile). Baked in at build time.                                   |
| `TURNSTILE_SECRET_KEY`                     | No                | Turnstile secret key. Server only.                                                                                                                                                                   |
| `AUTH_REQUIRE_EMAIL_VERIFICATION`          | No                | Defaults to `true` in production. Set `false` only for tests.                                                                                                                                        |
| `OCR_PROVIDER`                             | No                | `fixture` returns canned results. Tests only.                                                                                                                                                        |

### Bot protection (Turnstile)

Optional. With it on, sign-up, sign-in, password reset, resending the confirmation link and the support form
require a passed [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) check. It is invisible unless
Cloudflare needs the visitor to do something.

1. In the Cloudflare dashboard, open **Turnstile**, add a widget for your domain in
   **Managed** mode, and copy the site key and secret key.
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together. The app refuses to start with only one.
   Tokens must report the `BETTER_AUTH_URL` hostname; `TURNSTILE_ALLOWED_HOSTNAMES` (comma-separated) overrides that.
3. Redeploy. The site key is inlined into the client bundle when the app is built, so changing it needs a new build;
   the secret is read at runtime. The Content Security Policy allows `challenges.cloudflare.com` only when the site
   key is set.

If Cloudflare cannot be reached when a form is submitted, the request is refused rather than let through. For local
and test runs, Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) work
on any host: site `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA` always passes; secret
`2x0000000000000000000000000000000AA` always fails. Their siteverify reports the hostname `example.com`, so set `TURNSTILE_ALLOWED_HOSTNAMES=example.com` with them. `scripts/test.sh --turnstile` does that.

### 5. Deploy

**Vercel.** `.github/workflows/production.yml` runs after CI passes on a push to `main`: it migrates staging, then
production, then deploys. If either migration fails, nothing is deployed. Pull requests get a preview deploy from
`.github/workflows/preview.yml`. To run the whole pipeline by hand, run the **Vercel Production Deployment** workflow
from the Actions tab on `main`.

The two Vercel workflows use separate GitHub environments, each holding the same three secrets (`VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`):

| Environment      | Used by          | Branch policy             | Notes                                                       |
| ---------------- | ---------------- | ------------------------- | ----------------------------------------------------------- |
| `vercel`         | `production.yml` | `main` only (recommended) | Consider a required reviewer: every production deploy waits |
| `vercel-preview` | `preview.yml`    | None (every PR)           | Kept apart so a reviewer on `vercel` never blocks previews  |

**Every production secret is stored as Vercel _Sensitive_.** Sensitive values can't be read back, so `vercel pull` in
CI gets empty or placeholder values for them and the build must not depend on them: `lib/env.ts` treats a malformed
runtime-only secret as unset during `next build` and refuses it only when the server starts. This is also what limits
the Vercel token: it reaches same-repository PR runs (preview.yml), and while it can deploy, it can't read production
secrets. Mark any new production secret Sensitive when you add it. A required reviewer on `vercel` plus its `main`-only
policy keeps PR runs from using that environment at all; the token itself stays account-wide, so treat it like a
production credential and rotate it if a PR workflow might have leaked it.

**Docker.** Build `docker/Dockerfile.prod`, run migrations once with the `builder` stage
(`bun run db:migrate`, as the `migrate` service in `docker-compose.yml` does), then start the image with the
variables above, `TRUSTED_IP_HEADERS` included.

### Migrations in CI

[`db-migrate.yml`](../.github/workflows/db-migrate.yml) runs `bun run db:migrate` against one database, reading
`DIRECT_URL` (the session pooler URL, port 5432) from a GitHub environment. `production.yml` calls it twice:

```text
CI passes on main → migrate staging-db → migrate production-db → deploy production
```

Each step waits for the one before it, so a migration that fails on staging never reaches production, and a failed
migration never ships code that needs it. `drizzle-kit migrate` applies all pending files in **one transaction**, so a
failed run leaves that database exactly as it was. The job fails, rather than skips, when run from any ref but `main`.
The URL isn't printed: GitHub masks the secret, the check step also masks the decoded password, and `drizzle-kit`
runs without `--verbose`.

One migration runs per database at a time (`concurrency: db-migrate-<environment>`, shared by the pipeline and manual
runs, never cancelled while running). GitHub keeps only one _pending_ run per group, so starting a manual run while a
pipeline migration is waiting cancels the waiting one, and that pipeline run's deploy is skipped. Re-run it afterwards.

Set these up in this order, before merging anything that relies on them (GitHub: Settings → Environments → New
environment):

1. **Create the environments with the branch policy first:** `staging-db` and `production-db`, each with
   Deployment branches → Selected branches → `main` only. Adding a secret to an environment without that policy lets
   any branch's workflow read it.
2. **Then add the secrets:** `DIRECT_URL` in each.
3. **Then merge.**

| Environment     | Branch policy                                                | Secret                                                 |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `staging-db`    | `main` only                                                  | `DIRECT_URL`: `receipt-ocr-staging` session pooler URL |
| `production-db` | `main` only; consider a required reviewer for each migration | `DIRECT_URL`: `receipt-ocr` session pooler URL         |

If an environment is missing, GitHub creates an empty one, with no branch policy, on the first run; the job then fails
at "Check the secret is set" and the deploy doesn't run. With a required reviewer on `production-db`, every deploy
waits for that approval, including releases without a new migration.

To migrate one database by hand (to retry after a fix, or to bring staging up to date), run **Database Migration**
from the Actions tab on `main` and choose `staging-db` or `production-db`.

### Staging and previews

- **Staging database:** Supabase project `receipt-ocr-staging` (us-east-1, same region as production and the `iad1`
  functions). It gets every migration from `main` a moment before production does.
- **Previews:** set the Vercel project's **Preview** variables to staging: `DATABASE_URL` (staging transaction
  pooler), separate storage bucket or prefix, and a different `BETTER_AUTH_SECRET` from production. Leave
  `BETTER_AUTH_URL` unset: on a preview (`VERCEL_ENV=preview`) the app uses `https://$VERCEL_BRANCH_URL`, or
  `https://$VERCEL_URL` when there is no branch alias. Sign-in, invite, verification and reset links then point at the
  preview, never at production. The preview's own hosts are trusted on a preview even when `BETTER_AUTH_URL` is set
  there (it then only changes the canonical origin and email links). Production ignores both variables and always
  uses exactly `BETTER_AUTH_URL`.
- **Protect previews:** turn on Vercel Deployment Protection (Project → Settings → Deployment Protection, Vercel
  Authentication for preview deployments) so only your team can open them. They hold a working sign-in against the
  staging database.
- **Previews never run migrations.** A PR that adds a migration has no tables on staging until it merges and the
  pipeline migrates staging, so pages that touch the new schema fail on that PR's preview. Test those against the
  local compose stack (`scripts/test.sh`), which applies every migration to a fresh database.
- **Email:** keep verification on. Give Preview its own `RESEND_API_KEY` and `EMAIL_FROM` (a separate key, and
  Resend's test addresses such as `delivered@resend.dev` for throwaway accounts); previews then send links to the
  preview. Without a mailer, email sign-up can't complete on a preview.
- **Google and GitHub sign-in** need each preview host registered as a callback URL, which the random hosts make
  impractical. Leave the OAuth variables unset for Preview so the buttons are hidden, and use email and password.
- **Turnstile:** tokens must come from one of the preview's hosts. Use Cloudflare's test keys for Preview, or leave
  Turnstile off there.
- **Site URL:** `NEXT_PUBLIC_SITE_URL` only sets canonical links, the sitemap and social cards. Setting the production
  URL for Preview is fine: Vercel sends `X-Robots-Tag: noindex` on its generated preview URLs (`*.vercel.app`). That
  header isn't added for a custom domain assigned to a branch, so don't give previews one without adding your own
  noindex. Left unset, previews omit canonical links.

### 6. First admin

Put your email in `ADMIN_EMAILS` before you sign up. For an account that already exists:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you@example.com';
```

Then open `/admin/settings` and check the plan limits and the OCR model chain. Until something is saved there, the
app uses the defaults in `packages/core/src/plans.ts` (Free: 20 receipts a day) and `GEMINI_MODEL`.

### 7. Check it works

- Sign up with email and confirm the verification email arrives.
- Upload a receipt and confirm it is read, appears in History and exports to CSV.
- Open `/admin` and confirm the receipt shows on the overview.
- `curl https://<your domain>/api/health/ready` returns `"ok":true`. Point an uptime monitor at it. When something
  breaks, see the [runbook](runbook.md).

### Upload size limit

The app accepts files up to 10 MB (`MAX_UPLOAD_BYTES`), but Vercel rejects any request body over **4.5 MB** with a 413.
The browser therefore shrinks photos (long edge 2,000 px, JPEG) before uploading and refuses a file that is still over
`DEPLOYMENT_BODY_LIMIT_BYTES` (4 MB, leaving room for the multipart envelope), so large PDFs are turned away with a
clear message instead of a failed request. Both constants live in `packages/core/src/upload-limits.ts`. A Docker
deployment without that proxy limit can raise `DEPLOYMENT_BODY_LIMIT_BYTES` up to 10 MB by editing the constant and rebuilding.
On Docker, also cap request bodies in the reverse proxy in front of the image (for example nginx
`client_max_body_size 11m;`), so oversized requests are refused before they reach the app.

## Every release

Code that needs a new migration will fail against the old schema, while the old code keeps working against the new
schema. So **apply migrations first, then deploy**. The pipeline does that for you on every push to `main`
([Migrations in CI](#migrations-in-ci)); the steps below are what's left for the owner.

1. **See what's new since the last deploy.** Replace `<deployed>` with the commit currently live (shown in the
   Vercel deployment):

   ```bash
   git fetch origin
   git diff --name-only <deployed> origin/main -- apps/web/drizzle '*.env.example'
   ```

   New files in `apps/web/drizzle/` are migrations. Changes to an `.env.example` mean new or changed variables.

2. **Read each new migration.** They are plain SQL files. Look for anything that rewrites or drops data.

3. **Back up** before merging a PR with a migration: the merge applies it. On Supabase, check point-in-time recovery or
   take a backup from the dashboard. Elsewhere:

   ```bash
   pg_dump "$DIRECT_URL" --format=custom --file=backup-$(date +%F).dump
   ```

4. **Add new environment variables** in Vercel or the container before the deploy that needs them.

5. **Merge to `main`.** After CI, the pipeline migrates staging, then production, then deploys. If a migration
   fails, see [the runbook](runbook.md#migration-failed-in-ci). On Docker, run `bun run db:migrate` with the
   production `DIRECT_URL`, then roll out the new image.

6. **Check the pipeline finished:** all three jobs of the **Vercel Production Deployment** run are green.

7. **Smoke test.** Run the checks from [step 7](#7-check-it-works).

### Rolling back

- **Code:** in Vercel, open Deployments and promote the previous production deployment. On Docker, run the previous
  image tag.
- **Database:** migrations only go forward. Old code runs against the newer schema, so a code rollback normally
  needs nothing else. If a migration damaged data, restore the backup from step 3.

### Rotating the auth secret

The auth secret signs sessions and encrypts stored OAuth tokens.

Before the first rotation (step 0), set `BETTER_AUTH_SECRETS=1:<current BETTER_AUTH_SECRET>` and deploy. Nobody is signed
out, and tokens sealed from then on carry a version, so `BETTER_AUTH_SECRET` can later be removed safely.

To rotate:

1. Keep `BETTER_AUTH_SECRET` as it is, and set `BETTER_AUTH_SECRETS=2:<new secret>,1:<current secret>`.
2. Deploy. New sessions and tokens use version 2, and version 1 still decrypts older tokens.
3. Remove old versions only once nothing sealed under them is still needed. Removing `BETTER_AUTH_SECRET` before
   step 0 above makes tokens sealed without a version unreadable.

Changing the current version signs everyone out. Losing every secret makes stored OAuth tokens unreadable, so users
have to sign in with their provider again.

## Release notes

Steps specific to one release, newest first.

### Admin panel (migration `0006_admin_audit_settings`)

- **Migration:** adds the `admin_audit_log` and `app_settings` tables and the `receipts.model` column. It also makes
  `receipts.user_id` nullable with `ON DELETE SET NULL`, so receipts outlive a deleted uploader, and adds an index
  on `receipts.last_attempt_at`. It doesn't rewrite existing rows.
- **New variables:** `SUPPORT_EMAIL`, plus `TRUSTED_IP_HEADERS` on Docker hosts (and `TRUSTED_PROXIES` if the proxy appends to the header).
  `BETTER_AUTH_SECRETS` is optional.
- **Auth hardening:** existing sessions, OAuth tokens and pending reset links keep working. Don't rotate the auth
  secret in the same release. Setting `BETTER_AUTH_SECRETS=1:<current secret>` now is recommended (see
  [Rotating the auth secret](#rotating-the-auth-secret)).
- **Vercel:** leave `TRUSTED_IP_HEADERS` and `TRUSTED_PROXIES` unset. After deploy, check the logs for
  `http.client_ip_unresolved`; it should never appear.
- **After deploy:** the Free plan default drops to 20 receipts a day. Change it in **Admin → Settings** if you want
  something else.

## Lab design pages

The `(lab)` design directions (`/landing-a` to `/landing-h`, `/final-*`) return 404 in production builds. They are
prerendered, so set `LAB_PAGES=1` for the build, not just the runtime, to show them. The variable is listed in
`turbo.json` under `tasks.build.env`, so Turbo passes it through.
