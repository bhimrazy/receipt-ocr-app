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

On Vercel, apply migrations with the **Database Migration** workflow (see [Migrations](#migrations)). For a
brand-new database you can also apply them from your machine:

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
`apps/web/.env.example` explains each one; [production-environment.md](production-environment.md) walks through them in order
(R2, AI keys, Resend), marking which are secrets.

| Variable                                   | Required          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Yes               | Transaction pooler URL on Supabase.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `DIRECT_URL`                               | For migrations    | Session pooler URL. Not needed by the running app; CI reads it from the `staging-db` and `production-db` GitHub environments, not from Vercel.                                                                                                                                                                                                                                                                                                                 |
| `BETTER_AUTH_SECRET`                       | Yes               | `openssl rand -base64 32`. See [Rotating the auth secret](#rotating-the-auth-secret).                                                                                                                                                                                                                                                                                                                                                                          |
| `BETTER_AUTH_SECRETS`                      | No                | Versioned secrets for rotation, current first: `2:<new>,1:<old>`.                                                                                                                                                                                                                                                                                                                                                                                              |
| `BETTER_AUTH_URL`                          | Yes               | The exact origin users visit, e.g. `https://receiptocr.example.com`. Requests from any other host (such as a `*.vercel.app` alias) are refused. Leave it unset for Vercel previews.                                                                                                                                                                                                                                                                            |
| `NEXT_PUBLIC_SITE_URL`                     | No                | Not read any more. Canonicals, the sitemap and social cards use `PRODUCTION_HOST` in `apps/web/lib/seo-hosts.ts`.                                                                                                                                                                                                                                                                                                                                              |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | Yes               | For R2, `S3_REGION=auto`.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `S3_FORCE_PATH_STYLE`                      | No                | `true` for RustFS and other self-hosted stores.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GOOGLE_GENERATIVE_AI_API_KEY`             | Yes               | Gemini key.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GEMINI_MODEL`                             | No                | Fallback after Claude Sonnet until a chain is saved. After that, choose models in **Admin → Settings**.                                                                                                                                                                                                                                                                                                                                                        |
| `ANTHROPIC_API_KEY`                        | No                | Claude key. Offers the Claude models in **Admin → Settings**; Gemini stays the default. Use a key of its own with a monthly spend limit in the Anthropic Console.                                                                                                                                                                                                                                                                                              |
| `GROQ_API_KEY`                             | No                | Groq key. Offers Qwen 3.8 27B (vision) in **Admin → Settings**. Free-plan limits (30 requests and 8K tokens a minute, 1K requests a day) are in [ai.md](architecture/ai.md#groq). **Before adding a site key, enable Zero Data Retention** in the Groq org's Data Controls settings: without it Groq may log inputs and outputs for up to 30 days ([Your Data](https://console.groq.com/docs/your-data), checked 2026-11-07), which the privacy policy states. |
| `OPENAI_API_KEY`                           | No                | OpenAI key. Offers GPT-6 Luna and GPT-6.1 Terra in **Admin → Settings**. Use a project key with a spend limit. OpenAI keeps requests up to 30 days for abuse monitoring; zero data retention needs OpenAI's approval (see [ai.md](architecture/ai.md#openai)).                                                                                                                                                                                                 |
| `OCR_DAILY_CAP`                            | No                | Spend guard: OCR rounds per UTC day across all users (each upload or retry is one round, plus each provider attempt).                                                                                                                                                                                                                                                                                                                                          |
| `RESEND_API_KEY`, `EMAIL_FROM`             | Yes in production | Without them, verification and reset links are only logged.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SUPPORT_EMAIL`                            | Yes in production | Inbox for support-form messages.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ADMIN_EMAILS`                             | Recommended       | Comma-separated emails made admin when they sign up.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No                | Google sign-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No                | GitHub sign-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `TRUSTED_IP_HEADERS`                       | Off Vercel only   | The header your proxy sets to the client IP, e.g. `x-forwarded-for`. The app refuses to start in production without it, because rate limits would otherwise share one bucket. Leave unset on Vercel.                                                                                                                                                                                                                                                           |
| `TRUSTED_PROXIES`                          | No                | Required if your proxy appends to that header rather than overwriting it (nginx's default). Otherwise every client shares one rate-limit bucket, and the app logs `http.client_ip_unresolved`.                                                                                                                                                                                                                                                                 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`           | No                | Cloudflare Turnstile site key. Set with `TURNSTILE_SECRET_KEY` to turn bot protection on; see [Bot protection](#bot-protection-turnstile). Baked in at build time.                                                                                                                                                                                                                                                                                             |
| `TURNSTILE_SECRET_KEY`                     | No                | Turnstile secret key. Server only.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`            | No                | GA4 id (`G-…`): cookie banner, then GA after consent; see [Analytics and cookie consent](#analytics-and-cookie-consent). Build time; an invalid value leaves GA off.                                                                                                                                                                                                                                                                                           |
| `AUTH_REQUIRE_EMAIL_VERIFICATION`          | No                | Defaults to `true` in production. Set `false` only for tests.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ADMIN_MFA_ENFORCE`                        | No                | Defaults to on in production: admins need two-step sign-in. `false` is the emergency off switch (see [Admin locked out](#admin-locked-out-of-two-step-sign-in)).                                                                                                                                                                                                                                                                                               |
| `OCR_PROVIDER`                             | No                | `fixture` returns canned results. Tests only.                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

### Analytics and cookie consent

Analytics runs only on public pages (`/`, `/sign-in`, `/sign-up`, `/privacy`, `/terms`, `/cookies`), never in `/app`
or `/admin`, and page addresses are sent without their query string.

- **Vercel Web Analytics** (cookie-free page counts) is on in every Vercel build. Turn it on for the project in the
  Vercel dashboard (**Analytics → Enable**); no env var is needed. Visitors can switch it off in Cookie settings, and
  Do Not Track and Global Privacy Control turn it off, and with GA configured it waits for a choice. Docker images run no analytics.
- **Google Analytics 4** is optional. Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and rebuild. The site then shows a cookie
  banner, and gtag.js loads only after a visitor accepts, with Consent Mode v2 signals denied by default and only
  `analytics_storage` ever granted. The CSP adds Google's origins only when the id is set. In the GA property:
  - Admin → Data streams → Enhanced measurement: turn off **Page changes based on browser history events**. The app
    sends its own page views with stripped URLs; GA's history events would send the full URL.
  - Leave Google signals and ads links off. Nothing in the app asks for advertising consent.

To ask everyone again after changing what an optional tool does, bump `CONSENT_VERSION` in
`apps/web/lib/consent/config.ts`. New cookies or storage keys need an entry in `apps/web/lib/consent/cookies.ts`
(a unit test fails otherwise), which also updates `/cookies`.

### 5. Deploy

**Vercel.** `.github/workflows/production.yml` deploys `main` automatically after CI passes on a push, unless the
release changes migrations (see [Migrations](#migrations)). Pull requests get a preview deploy from
`.github/workflows/preview.yml`. To deploy by hand, run the **Vercel Production Deployment** workflow from the
Actions tab on `main`; a manual run deploys once CI passed on that commit and production has its migrations.

Both Vercel workflows use the GitHub environment `vercel`, which holds `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`. It has no branch policy, because previews run from PR branches; don't add one, or previews stop.

**Every production secret is stored as Vercel _Sensitive_.** Sensitive values can't be read back, so `vercel pull` in
CI gets empty or placeholder values for them and the build must not depend on them: `lib/env.ts` treats a malformed
runtime-only secret as unset during `next build` and refuses it only when the server starts. Mark any new production
secret Sensitive when you add it.

**The Vercel token reaches PR runs.** The same `VERCEL_TOKEN` that deploys production is available to same-repository
PR runs of `preview.yml`, so a PR branch could deploy to production with it. What limits that today: production
secrets are Sensitive, so the token can't read them back, and the repository has no outside collaborators (fork PRs
get no secrets). The full fix is a separate Vercel project for previews with its own token. Treat the token as a
production credential and rotate it if a PR workflow might have leaked it.

**Docker.** Build `docker/Dockerfile.prod`, run migrations once with the `builder` stage
(`bun run db:migrate`, as the `migrate` service in `docker-compose.yml` does), then start the image with the
variables above, `TRUSTED_IP_HEADERS` included.

### Migrations

Migrations run **only by hand**, through [`db-migrate.yml`](../.github/workflows/db-migrate.yml) (Actions →
**Database Migration** → Run workflow on `main`, choosing `staging-db` or `production-db`). It runs
`bun run db:migrate` with that environment's `DIRECT_URL` (the session pooler URL, port 5432). No other workflow runs
it, and previews never do.

`production.yml` never deploys code whose migrations may not be applied. On its automatic path it compares
`apps/web/drizzle/` between the commit CI tested and the commit production runs
(`.github/scripts/last-deployed-sha.sh`: the commit the live site reports at `/api/health`; if that can't be read the gate skips; CI creates no git tags). If anything changed there,
or no such run is found, it skips the deploy and the run
summary says what to do. A manual run instead checks that CI passed on the commit and that the newest successful
**Database Migration** run for `production-db` had the same `apps/web/drizzle/`; otherwise it refuses: "main has
migrations production hasn't run: run Database Migration for production-db first."

```text
push to main → CI → production.yml: no migration changes → deploy, move the tag
                                    migration changes   → skip ("run Database Migration ...")
```

How the migration job behaves:

- `drizzle-kit migrate` applies all pending files in **one transaction**, so a failed run leaves that database exactly
  as it was.
- A `preflight` job runs before the environment's approval. It fails, rather than skips, when started from any ref
  but `main`. For `production-db` it also requires the newest successful `staging-db` run to have the same
  `apps/web/drizzle/` as this commit ("run staging first on this commit"). Runs are named `Migrate <environment>`,
  which is how these lookups find them; any lookup that fails refuses the run.
- The URL isn't printed: GitHub masks the secret, the check step validates its shape without echoing it and also
  masks the decoded username (it carries the Supabase project ref) and password, and `drizzle-kit` runs without `--verbose`.
- CI's static job runs `bun run db:generate` (no database needed) and fails if `apps/web/drizzle/` changes, so a
  schema change can't merge without its migration.
- One run per database at a time (`concurrency: db-migrate-<environment>`, never cancelled while running). GitHub
  keeps only one _pending_ run per group, so a second run started while one waits (for example for approval) cancels
  the waiting one.

The environments, set up in this order (GitHub: Settings → Environments → New environment):

1. **Create the environments with the branch policy first:** `staging-db` and `production-db`, each with
   Deployment branches → Selected branches → `main` only. Adding a secret to an environment without that policy lets
   any branch's workflow read it.
2. **Then add the secrets:** `DIRECT_URL` in each.
3. **Then merge** anything that relies on them.

| Environment     | Branch policy                          | Secret                                                 |
| --------------- | -------------------------------------- | ------------------------------------------------------ |
| `staging-db`    | `main` only                            | `DIRECT_URL`: `receipt-ocr-staging` session pooler URL |
| `production-db` | `main` only; required reviewer (owner) | `DIRECT_URL`: `receipt-ocr` session pooler URL         |

Both exist today. If one is ever missing, GitHub creates it empty, with no branch policy, on the first run; the job
then fails at "Check the secret is set".

### Staging and previews

- **Getting a preview:** until launch, a PR deploys a preview only when it has the `preview` label. Add it once the PR
  is ready to look at: `gh pr edit <number> --add-label preview`. The deploy starts at once and its link is posted on
  the PR. Later pushes don't redeploy; to refresh it, remove and re-add the label. Each deploy counts toward Vercel's
  100 a day, which production shares.
- **Production skips merges that ship nothing:** when everything since the last production deploy is docs, Markdown,
  tests, benchmarks, repo scripts or CI config (`.github/scripts/shipped-files.sh`), the gate skips the deploy; the next
  merge that changes the app deploys it all.
- **Staging database:** Supabase project `receipt-ocr-staging` (us-east-1, same region as production and the `iad1`
  functions). Migrate it before production on every release with migrations, and check it there first.
- **Previews:** set the Vercel project's **Preview** variables to staging: `DATABASE_URL` (staging transaction
  pooler), separate storage bucket or prefix, and a different `BETTER_AUTH_SECRET` from production. Leave
  `BETTER_AUTH_URL` unset: on a preview (`VERCEL_ENV=preview`) the app uses `https://$VERCEL_BRANCH_URL`, or
  `https://$VERCEL_URL` when there is no branch alias. Sign-in, invite, verification and reset links then point at the
  preview, never at production. The preview's own hosts are trusted on a preview even when `BETTER_AUTH_URL` is set
  there (it then only changes the canonical origin and email links). Production ignores both variables and always
  uses exactly `BETTER_AUTH_URL`.
- **Fixed preview:** pushing to the `preview` branch deploys it and serves it at
  `preview.receipt-ocr.bhimraj.com.np`. See [Domains in production-environment.md](production-environment.md#domains).
- **Protect previews:** turn on Vercel Deployment Protection (Project → Settings → Deployment Protection, Vercel
  Authentication for preview deployments) so only your team can open them. They hold a working sign-in against the
  staging database.
- **Previews never run migrations.** A PR that adds a migration has no tables on staging until it merges and someone runs
  **Database Migration** on `staging-db`, so pages that touch the new schema fail on that PR's preview. Test those against the
  local compose stack (`scripts/test.sh`), which applies every migration to a fresh database.
- **Email:** keep verification on. Give Preview its own `RESEND_API_KEY` and `EMAIL_FROM` (a separate key, and
  Resend's test addresses such as `delivered@resend.dev` for throwaway accounts); previews then send links to the
  preview. Without a mailer, email sign-up can't complete on a preview.
- **Google and GitHub sign-in** need each preview host registered as a callback URL, which the random hosts make
  impractical. Leave the OAuth variables unset for Preview so the buttons are hidden, and use email and password.
- **Turnstile:** tokens must come from one of the preview's hosts. Use Cloudflare's test keys for Preview, or leave
  Turnstile off there.
- **Indexing:** only `PRODUCTION_HOST` (`apps/web/lib/seo-hosts.ts`) is indexable. Every other host gets
  `Disallow: /` in robots.txt, `X-Robots-Tag: noindex, nofollow` on every response (next.config.ts, keyed on the
  request host) and no `/llms.txt`, so custom preview domains are covered without any Vercel setting. Both checks
  read the `Host` header, so a reverse proxy in front of the Docker image must pass the original `Host` through
  (nginx: `proxy_set_header Host $host;`), or production is served as noindex.

### 6. First admin

Put your email in `ADMIN_EMAILS` before you sign up. For an account that already exists:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you@example.com';
```

Then open `/admin/settings` and check the plan limits and the OCR model chain. Until something is saved there, the
app uses the defaults in `packages/core/src/plans.ts` (Free: 20 receipts a day) and the chain Claude Sonnet 5.5,
then `GEMINI_MODEL`; a step whose provider has no key is skipped.

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

### Installable app (PWA)

Nothing to configure. `next.config.ts` serves `/sw.js` with `Cache-Control: no-cache`, on Vercel and in Docker, so
browsers pick up a new worker on their next visit. If a CDN or proxy sits in front of a Docker deployment, make sure
it does not cache `/sw.js` either. The service worker needs HTTPS (or `localhost`).

## Every release

Code that needs a new migration will fail against the old schema, while the old code keeps working against the new
schema. So **apply migrations first, then deploy**. Migrations therefore run while the previous release is still live,
and must stay **backward compatible with the code currently in production**: expand, then contract. Add tables,
nullable or defaulted columns and indexes in one release; drop or rename only in a later release, once no live code
reads the old shape.

A release without migration changes deploys by itself after CI. For one with migrations:

1. **See what's new since the last deploy:**

   ```bash
   git fetch origin
   GITHUB_REPOSITORY=bhimrazy/receipt-ocr-app .github/scripts/last-deployed-sha.sh  # last deployed commit
   git diff --name-only <that sha> origin/main -- apps/web/drizzle '*.env.example'
   ```

   New files in `apps/web/drizzle/` are migrations. Changes to an `.env.example` mean new or changed variables.

2. **Read each new migration.** They are plain SQL files. Look for anything that rewrites or drops data, or that the
   live code can't run against.

3. **Back up** production. On Supabase, check point-in-time recovery or take a backup from the dashboard. Elsewhere:

   ```bash
   pg_dump "$DIRECT_URL" --format=custom --file=backup-$(date +%F).dump
   ```

4. **Add new environment variables** in Vercel or the container before the deploy that needs them.

5. **Merge the PR to `main`.** After CI, **Vercel Production Deployment** skips the deploy; its summary says the
   release adds migrations.

6. **Migrate staging:** Actions → **Database Migration** → Run workflow on `main`, environment `staging-db`. Check
   staging (sign in on a preview, open the pages the migration touches).

7. **Migrate production:** run **Database Migration** again with `production-db` and approve it in GitHub (required
   reviewer). If either run fails, see [the runbook](runbook.md#migration-failed).

8. **Deploy:** run **Vercel Production Deployment** by hand on `main`. On Docker, run `bun run db:migrate` with the
   production `DIRECT_URL`, then roll out the new image.

9. **Smoke test.** Run the checks from [step 7](#7-check-it-works).

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

In production the current secret must be at least 32 characters, or the app refuses to start. Secrets are stored as
Vercel Sensitive, so nobody can read them back: keep a copy in a password manager, because step 1 needs the current
value. Without it you can still rotate by setting only the new version. That signs everyone out, and the app never
reads stored OAuth tokens, so nothing else breaks. Since two-step sign-in shipped it also loses every TOTP secret and
backup code sealed under the old version.

The production secret was last replaced on 2026-11-08, during the pre-launch reset. Step 0 was done the same day,
before two-step sign-in shipped: production has `BETTER_AUTH_SECRETS=1:<current secret>` and `BETTER_AUTH_SECRET`
set to the same value.

**Two-step sign-in secrets are sealed with these keys too, and never re-sealed.** Keep every version listed for as long
as any `two_factor` row was written under it: removing one makes those authenticators unreadable, and their users can
then only sign in after an admin reset. To check what is still in use:
`select split_part(secret, '$', 3) as version, count(*) from two_factor group by 1;` (rows without a `$ba$` prefix use
the legacy `BETTER_AUTH_SECRET`). Emailed step-up codes are keyed by the current secret, so a rotation only invalidates
codes sent in the last 10 minutes.

### Admin locked out of two-step sign-in

- **Another admin exists:** they open Admin → Users → the admin → Reset 2FA (after checking it is really them). The
  locked-out admin signs in with their password and enrols again.
- **Only admin, lost the authenticator and the backup codes:** in the Supabase SQL editor (production needs the
  owner's go), `delete from two_factor where user_id = '<id>'; update "user" set two_factor_enabled = false where id = '<id>';`.
  They sign in with their password and enrol again in Settings → Security; enrolling needs no admin access.
- **Emergency, enforcement itself is in the way** (a bug, not a lost phone): `ADMIN_MFA_ENFORCE=false` in Vercel and
  redeploy. Admin changes still need step-up, so the admin still needs a factor for those.

## Release notes

Steps specific to one release, newest first.

### Schema fixes: receipt dates as `date` (`0003_schema_fixes`)

- **Run Database Migration before deploying** (`staging-db`, then `production-db`, then deploy by hand, as in
  [Every release](#every-release)). Written for the empty databases of the 2026-11-08 reset; nothing to back up or
  backfill.
- **Not fully backward compatible:** it changes `receipts.receipt_date` from text to `date`, and the previous
  release's dashboard query runs text functions on that column. Between the migration and the deploy, Home's spending
  section fails for anyone with completed receipts, saving an unreal date (`2026-02-30`) in the editor fails, and a
  receipt whose model date isn't a plausible ISO day fails to complete (it can be retried after the deploy). Deploy
  right after `production-db` succeeds. Rolling the code back afterwards has the same effect, so roll forward instead.
- **What it changes:** the `USING` cast keeps a real `YYYY-MM-DD` day from 2000 to the upload day + 1 and nulls
  anything else; `currency` is upper-cased and anything that isn't three letters becomes null. New checks on
  `receipt_date`, `currency`, `attempts` (1 to 3) and `receipt_items.quantity` (at least 1); new indexes on
  `(organization_id, receipt_date)` and on five foreign keys; `receipts_last_attempt_at_idx` and
  `member_organization_id_idx` dropped; `passkey.created_at` set not null. The file starts with
  `SET LOCAL lock_timeout = '5s'`, so if it waits on a lock it fails cleanly and can be rerun.
- **Check after migrating:** `select data_type from information_schema.columns where table_name = 'receipts' and
column_name = 'receipt_date';` returns `date`.

### Squashed baseline and row-level security (2026-11-07)

- **Migrations were squashed into one `0000_baseline`**, before launch. Both databases must be reset, not migrated.
  Reset each one (staging first) with the SQL below, then run the **Database Migration** workflow on `staging-db`,
  then `production-db` (the owner approves), then deploy by hand. Production auto-deploy may be skipped because the
  release adds a migration. Don't `DROP SCHEMA public`: it would lose Supabase's grants and default ACLs.

  Pre-check, and keep the output:

  ```sql
  select tablename, tableowner from pg_tables where schemaname = 'public' order by 1;
  select typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e';
  select current_user;
  select has_schema_privilege('anon', 'public', 'USAGE') as anon_usage;
  select 'receipts' as t, count(*) from public.receipts
    union all select 'user', count(*) from public."user"; -- expect empty or test data only
  ```

  Reset (no `CASCADE`, no `IF EXISTS`, so anything unexpected rolls it all back):

  ```sql
  begin;
  set local lock_timeout = '5s';
  drop table
    public.receipt_group_members, public.receipt_groups, public.receipt_items,
    public.ocr_calls, public.ocr_rounds, public.jobs, public.job_controls,
    public.admin_audit_log, public.app_settings, public.user_credentials,
    public.receipts, public.invitation, public.member, public.session,
    public.account, public.verification, public.rate_limit,
    public.organization, public."user";
  drop type public.job_state, public.receipt_status;
  drop table drizzle.__drizzle_migrations;
  drop schema drizzle;
  commit;
  ```

  Post-check: `pg_tables` for `public` returns no rows, no enum types are left, and
  `has_schema_privilege('anon', 'public', 'USAGE')` is unchanged from the pre-check.

- **RLS** is enabled on all 19 tables with no policies. The app role (`postgres`) bypasses it. In the Supabase
  dashboard each table shows the **RLS enabled** badge. The Data API is unused, so also remove `public` from
  Project Settings, Data API, **Exposed schemas**: then `anon` and `authenticated` cannot reach any table even by
  mistake. `service_role` bypasses RLS by design, so only removing `public` from the exposed schemas protects
  against a leaked service-role key.

### Admin panel (earlier release, now part of the baseline)

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
