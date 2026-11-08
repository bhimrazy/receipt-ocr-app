# Production environment setup

How to give an environment (Production or Preview) the keys it needs, one service at a time. The services and
variables are the same wherever the app runs; the steps for adding them are written for Vercel, where it runs today.
On Docker or a VPS, set the same variables in the container's environment instead. Follow the steps in order: each one
unlocks part of the app, and you can stop after step 3 with a working app.

## Checklist

| Step                                                         | Unlocks                              | Needed?  | Time   |
| ------------------------------------------------------------ | ------------------------------------ | -------- | ------ |
| [1. Storage (Cloudflare R2)](#1-storage-cloudflare-r2)       | Uploading receipts                   | Yes      | 10 min |
| [2. AI keys (Gemini, Claude)](#2-ai-keys)                    | Reading receipts                     | Yes      | 10 min |
| [3. Email (Resend)](#3-email-resend)                         | Sign-up verification, password reset | Yes      | 15 min |
| [4. Sign in with Google](#4-sign-in-with-google)             | The Google button                    | Optional | 15 min |
| [5. Sign in with GitHub](#5-sign-in-with-github)             | The GitHub button                    | Optional | 5 min  |
| [6. Bot protection (Turnstile)](#6-bot-protection-turnstile) | Spam protection on sign-up and forms | Optional | 5 min  |
| [7. Deploy and check](#7-deploy-and-check)                   | Everything above goes live           | Yes      | 5 min  |
| [8. Queue drain (cron)](#8-queue-drain-cron)                 | Failed or cut-off reads retry alone  | Yes      | 10 min |
| [9. Optional extras](#9-optional-extras)                     | Analytics, logs, error tracking      | Optional | varies |

The database, auth secret and site URL are already set; see [Already set](#already-set).

## How to add a variable

1. Vercel → the project → **Settings → Environment Variables → Add New**.
2. Type the **Key** and paste the **Value**.
3. Tick the environment: **Production** (the live site) or **Preview** (pull-request previews). Give each its own
   value: separate keys mean a leaked preview key can't touch production.
4. If the table below says **Secret**, switch on **Sensitive**, then **Save**.

- **Secret**: a password or API key. Sensitive values can never be read back, not even by you, so save a copy in
  your password manager first.
- **Config**: a setting that isn't secret (a bucket name, an email address). Leave Sensitive off so you can see it
  later.

Nothing changes on the live site until the next deploy ([step 7](#7-deploy-and-check)).

> Only add a variable once you have its real value. A placeholder is worse than nothing: the app thinks the service
> is ready and then fails on every request.

---

## 1. Storage: Cloudflare R2

**Unlocks:** uploading receipts. Without it, every upload fails.

<details>
<summary><b>Get the values from Cloudflare</b> (bucket, endpoint, access keys)</summary>

1. Open the Cloudflare dashboard → **R2 Object Storage**. The first time, turn R2 on (it asks for a payment method
   even for the free allowance).
2. **Create bucket**
   - Name: `receipt-ocr` for Production, `receipt-ocr-staging` for Preview.
   - Location: **Eastern North America** (close to Vercel's servers).
   - Leave public access **off** and add no custom domain. The app shows images through short-lived private links.
3. Copy your **Account ID** from the right-hand side of the R2 page. Your endpoint is
   `https://<account-id>.r2.cloudflarestorage.com`.
4. **Manage API tokens → Create API token**
   - Permissions: **Object Read & Write**.
   - Buckets: **Apply to specific buckets only** → pick the one bucket.
5. **Create API token** and copy the **Access Key ID** and **Secret Access Key** straight away. The secret is shown
   only once.
6. Do steps 2, 4 and 5 again for the other environment's bucket.

More help: [Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/),
[API tokens](https://developers.cloudflare.com/r2/api/tokens/).

</details>

**Add to Vercel**

| Key                    | Example                                                       | Kind   |
| ---------------------- | ------------------------------------------------------------- | ------ |
| `S3_ENDPOINT`          | `https://<account-id>.r2.cloudflarestorage.com`               | Config |
| `S3_REGION`            | `auto`                                                        | Config |
| `S3_BUCKET`            | `receipt-ocr` (Production) or `receipt-ocr-staging` (Preview) | Config |
| `S3_ACCESS_KEY_ID`     | 32 letters and digits                                         | Secret |
| `S3_SECRET_ACCESS_KEY` | 64 letters and digits                                         | Secret |

**Check:** after deploying, `/api/health/ready` shows `"storage":"ok"`.

**Lifecycle rule for `_health/`:** the Connections check writes a tiny object under `_health/` and deletes it. If
a run is cut off, one can be left behind. In the bucket's **Settings → Object lifecycle rules**, add a rule for the
prefix `_health/` that deletes objects after 1 day.

**CORS: leave it unset.** The browser never calls R2 directly: uploads go through the app, and images load in a
plain `<img>` from a signed link, which needs no CORS. With no policy, no website's scripts can read the bucket's
responses, which is the strictest setting. Add one only when a feature needs it (direct browser uploads to R2, or a
script that fetches an image), and keep it to the one origin and the methods used:

```json
[
  {
    "AllowedOrigins": ["https://receipt-ocr.bhimraj.com.np"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Per-PR preview addresses change, so they can't have a policy. The fixed preview domain can: for the Preview bucket,
use `https://preview.receipt-ocr.bhimraj.com.np` as the one allowed origin (see [Domains](#domains)).

---

## 2. AI keys

**Unlocks:** reading receipts. Gemini is the default; Claude is an optional second choice the app falls back to.

### Gemini

<details>
<summary><b>Get a paid Gemini key from Google</b></summary>

Use a **paid** key. On the free tier Google may use what you send to improve its products, and receipts are personal
data.

1. [Google Cloud Console](https://console.cloud.google.com) → create a project (e.g. `receipt-ocr`) or pick yours.
2. **Billing** → link a billing account to that project.
3. [Google AI Studio](https://aistudio.google.com) → **Get API key → Create API key** → choose the same project.
   The key list should say **Paid**. If it says Free, billing isn't linked yet (step 2).
4. Lock the key to Gemini: Cloud Console → **APIs & Services → Credentials** → your key → **API restrictions →
   Restrict key** → tick **Generative Language API** → **Save**.
5. Recommended: **Billing → Budgets & alerts** → a monthly budget that emails you at 50%, 90% and 100%.

More help: [API keys](https://ai.google.dev/gemini-api/docs/api-key),
[Billing](https://ai.google.dev/gemini-api/docs/billing).

</details>

| Key                            | Example | Kind   |
| ------------------------------ | ------- | ------ |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `AIza…` | Secret |

### Claude (optional)

<details>
<summary><b>Get a Claude key with a spending limit</b></summary>

1. [Anthropic Console](https://console.anthropic.com) → **Settings → Workspaces → Create workspace** (e.g.
   `receipt-ocr-production`; make another for Preview).
2. Open the workspace → **Limits** → set a **monthly spend limit**. When it's reached, the app simply moves to the
   next model.
3. **API keys → Create key** inside that workspace, and copy it. It's shown only once.

Don't reuse a personal or development key.

More help: [Workspaces](https://docs.anthropic.com/en/api/workspaces).

</details>

| Key                 | Example    | Kind   |
| ------------------- | ---------- | ------ |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Secret |

**Check:** after deploying, **Admin → Settings → OCR models** shows **API key set** next to each provider. Pick and
order the models there. Keys are never typed into or shown in the admin page.

**Optional spend guards** (Config): `OCR_DAILY_CAP`, the most receipts read per day across everyone (e.g. `200`), and
`OCR_MONTHLY_BUDGET_USD`, the monthly budget the admin page tracks (e.g. `50`).

---

## 3. Email: Resend

**Unlocks:** verification emails at sign-up, password resets, workspace invites and the support form. Without it,
nobody can finish signing up.

<details>
<summary><b>Verify your domain and get a key from Resend</b></summary>

1. [Resend](https://resend.com) → **Domains → Add domain** → `receipt-ocr.bhimraj.com.np`, the app's own
   subdomain (not the apex `bhimraj.com.np`), so this app's mail settings and reputation stay apart.
2. Resend lists a few DNS records. Add each one at your DNS provider (where the domain is managed), exactly as shown.
   Also add a DMARC record if you don't have one: name `_dmarc`, type `TXT`, value `v=DMARC1; p=none;`.
3. Back in Resend, press **Verify DNS records** and wait for **Verified**. It usually takes minutes, sometimes a few
   hours.
4. **API Keys → Create API key** → permission **Sending access** → domain: the one you just verified. Copy it.

More help: [Domains](https://resend.com/docs/dashboard/domains/introduction),
[API keys](https://resend.com/docs/dashboard/api-keys/introduction).

</details>

| Key              | Example                                           | Kind   |
| ---------------- | ------------------------------------------------- | ------ |
| `RESEND_API_KEY` | `re_…`                                            | Secret |
| `EMAIL_FROM`     | `ReceiptOCR <noreply@receipt-ocr.bhimraj.com.np>` | Config |
| `SUPPORT_EMAIL`  | `receipt-ocr@bhimraj.com.np`                      | Config |

- `EMAIL_FROM` must use the domain you verified (`receipt-ocr.bhimraj.com.np`).
- Roles: **From** is `EMAIL_FROM`, a noreply address on the verified domain, for every automated email.
  **Reply-To** is `SUPPORT_EMAIL` on all of them, so replies reach a human. `SUPPORT_EMAIL` is also where
  support-form messages go; those carry the visitor's address as Reply-To instead. Unset, no Reply-To is sent.
- If you ever send marketing or newsletters, use a separate subdomain (for example
  `news.receipt-ocr.bhimraj.com.np`) so complaints there cannot hurt transactional deliverability.
- `SUPPORT_EMAIL` is where support-form messages go, so it must be an inbox you read. Resend only sends mail; to
  receive at that address, set up a mailbox or forwarding (for example Cloudflare Email Routing to your Gmail).
- On Preview, only send to Resend's test address `delivered@resend.dev`.

**Check:** sign up with a new address and the verification email arrives.

---

## 4. Sign in with Google

**Unlocks:** the "Continue with Google" button.

**One client per environment, in separate Google Cloud projects.** A leaked or rotated preview secret then never
touches production, each client lists only its own redirect address, and the consent screen (which belongs to the
project) can stay in **Testing** for staging while production is published.

| Google Cloud project            | Holds                                                                                                                       | Status                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `receipt-ocr` (Production)      | Published consent screen, the production web client, the production Gemini key                                              | Set up now                                |
| `receipt-ocr-staging` (Preview) | Consent screen left in Testing (test users only), a client for the preview domain, a preview Gemini key with a small budget | Only if previews ever need Google sign-in |

Today only Production gets Google sign-in. Previews use email and password: their addresses change with every pull
request, and Google needs each redirect address listed exactly.

<details>
<summary><b>Create the sign-in client in Google Cloud</b></summary>

1. [Google Cloud Console](https://console.cloud.google.com) → your project → **Google Auth Platform** (it used to be
   called "OAuth consent screen") → **Get started**.
2. **Branding**
   - App name: `ReceiptOCR`. User support email: yours.
   - Home page: `https://receipt-ocr.bhimraj.com.np`. Privacy policy: `…/privacy`. Terms: `…/terms`.
   - Authorised domain: `bhimraj.com.np`.
   - A logo is optional; adding one starts a short Google review.
3. **Audience** → **External**. While it says **Testing**, only the test users you list can sign in. Press
   **Publish app** to open it to everyone. No extra Google review is needed for the basic scopes this app uses.
4. **Data access → Add or remove scopes** → tick `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`.
5. **Clients → Create client** → **Web application**
   - Authorised JavaScript origins: `https://receipt-ocr.bhimraj.com.np`
   - Authorised redirect URIs: `https://receipt-ocr.bhimraj.com.np/api/auth/callback/google`
6. **Create**, then copy the **Client ID** and **Client secret**. Download the JSON as a backup: the secret may not
   be shown again.

For a staging client later, repeat in the `receipt-ocr-staging` project with the origin
`https://preview.receipt-ocr.bhimraj.com.np` and the redirect URI
`https://preview.receipt-ocr.bhimraj.com.np/api/auth/callback/google`. Leave its audience in **Testing** and add
yourself as a test user. The authorised domain `bhimraj.com.np` already covers the preview subdomain.

More help: [Google Auth Platform](https://support.google.com/cloud/answer/15544987),
[Better Auth: Google](https://www.better-auth.com/docs/authentication/google).

</details>

| Key                    | Example                                 | Kind   |
| ---------------------- | --------------------------------------- | ------ |
| `GOOGLE_CLIENT_ID`     | `1234…-abc….apps.googleusercontent.com` | Config |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-…`                              | Secret |

Add both to **Production** only. Never paste the production client into Preview.

**Check:** the sign-in page shows the Google button, and signing in returns you to the app.

---

## 5. Sign in with GitHub

**Unlocks:** the "Continue with GitHub" button.

**One OAuth app per environment.** A GitHub OAuth app allows exactly one callback URL, so production and a staging
app can't share one anyway. Create the production app now; previews use email and password. If previews ever need it,
create a second app, `ReceiptOCR (staging)`, with the callback
`https://preview.receipt-ocr.bhimraj.com.np/api/auth/callback/github`, and add its values to **Preview** only.

<details>
<summary><b>Create the sign-in app in GitHub</b></summary>

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - Application name: `ReceiptOCR`
   - Homepage URL: `https://receipt-ocr.bhimraj.com.np`
   - Authorization callback URL: `https://receipt-ocr.bhimraj.com.np/api/auth/callback/github`
   - Leave **Enable Device Flow** off.
3. **Register application** → copy the **Client ID**.
4. **Generate a new client secret** → copy it. It's shown only once.

More help: [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

</details>

| Key                    | Example               | Kind   |
| ---------------------- | --------------------- | ------ |
| `GITHUB_CLIENT_ID`     | `Ov23li…`             | Config |
| `GITHUB_CLIENT_SECRET` | 40 letters and digits | Secret |

Add both to **Production** only.

**Check:** the sign-in page shows the GitHub button.

---

## 6. Bot protection: Turnstile

**Unlocks:** an invisible human check on sign-up, sign-in, password reset and the support form.

<details>
<summary><b>Create the widget in Cloudflare</b></summary>

1. Cloudflare dashboard → **Turnstile → Add widget**.
2. Name: `receipt-ocr`. Hostname: `receipt-ocr.bhimraj.com.np`.
3. Widget mode: **Managed**. Pre-clearance: **No**.
4. **Create**, then copy the **Site key** and **Secret key**.

More help: [Get started](https://developers.cloudflare.com/turnstile/get-started/).

</details>

**Production**

| Key                              | Example       | Kind   |
| -------------------------------- | ------------- | ------ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `0x4AAAAAAA…` | Config |
| `TURNSTILE_SECRET_KEY`           | `0x4AAAAAAA…` | Secret |

**Preview: use Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), not a
second widget.** A real widget only passes on the hostnames listed in it, and every pull-request preview has a new
random address. The test keys always pass on any host, so previews still run the whole Turnstile flow. Previews sit
behind Vercel Deployment Protection, so bots can't reach them anyway.

| Key                              | Value                                 | Kind   |
| -------------------------------- | ------------------------------------- | ------ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA`            | Config |
| `TURNSTILE_SECRET_KEY`           | `1x0000000000000000000000000000000AA` | Secret |
| `TURNSTILE_ALLOWED_HOSTNAMES`    | `example.com`                         | Config |

The test keys report the hostname `example.com`, and the app checks the hostname, so Preview needs that third
variable. Never use the test keys in Production: they let every request through.

Add **both keys or neither** in each environment: with only one, the app refuses to start.

**Check:** the sign-up page loads, and signing up still works.

---

## 7. Deploy and check

1. GitHub → **Actions → Vercel Production Deployment → Run workflow** (branch `main`). For Preview, push to any pull
   request.
2. When it finishes, open `https://receipt-ocr.bhimraj.com.np/api/health/ready`. You should see
   `"database":"ok"` and `"storage":"ok"`.
3. Sign in as an admin, open **Admin → Settings → Connections** and press **Check now**. Each AI provider, file
   storage and its read/write access should say **Working**; a problem shows a short hint naming the variable to
   fix. For AI providers, Working means the key is accepted and the models are visible; billing and credit are not
   checked. Press **Send test email** to get one message at your own address. Nothing is shown but statuses, so keys
   stay private.
4. Sign up with a fresh email, confirm it, and upload a receipt.

### If something's wrong

| You see                                            | Likely cause                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `"storage":"not_configured"`                       | An `S3_` variable is missing, or no deploy since you added it.              |
| `"storage"` is anything else (not `ok`)            | Wrong endpoint, a typo in a key, or the token isn't allowed on that bucket. |
| Connections says **Key rejected**                  | The key is wrong or revoked: paste a fresh one, save, and deploy again.     |
| Connections says **Billing or quota**              | The provider account needs credit or a higher limit.                        |
| Admin shows **no API key** for a provider          | The key isn't set for this environment, or no deploy since.                 |
| Uploads go in but receipts fail to read            | The key is wrong or has no billing; check the provider's usage page.        |
| No verification email                              | Domain not verified in Resend, or `EMAIL_FROM` uses a different domain.     |
| Google says "Access blocked" or "app not verified" | The app is still in **Testing**: publish it (step 4.3).                     |
| Google says "redirect_uri_mismatch"                | The redirect URI doesn't match exactly (https, no trailing slash).          |
| The site won't start after adding Turnstile        | Only one of the two Turnstile keys is set.                                  |

---

## 8. Queue drain (cron)

Receipts are read by jobs in the Postgres queue. The upload request runs its own job and its retries in `after()`, but
a job that was cut off (deploy, crash, the function's time limit) or is waiting for a retry needs something to run it
without anyone keeping a page open. That is `/api/jobs/drain`: one bounded pass over the queue (reaps expired leases,
then runs due jobs, claiming only in the first 5 s of a 55 s budget so a job at its 50 s OCR deadline still finishes
within the 60 s limit). The cap is 10 jobs a call, but a receipt job can take up to 50 s, so a busy minute runs only a
few; the rest wait for the next call. It never sleeps for a retry's backoff; that job waits for the next
call. Any number of callers at once is safe: jobs are claimed with `FOR UPDATE SKIP LOCKED`.

It is protected by `CRON_SECRET` (`Authorization: Bearer <secret>`). With no secret set it answers `503` and runs
nothing; a wrong or missing one gets `401`. `GET` and `POST` do the same.

Two triggers call it:

| Trigger                | Schedule         | Why                                                                                   |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Vercel Cron (built in) | daily, 03:00 UTC | Backstop. [`apps/web/vercel.json`](../apps/web/vercel.json). Hobby allows once a day. |
| Supabase `pg_cron`     | every 5 minutes  | The real recovery loop. Live in production since 2026-11-08 (job `drain-jobs`).       |

### 8a. Vercel

1. **Settings → Environment Variables → Add New**: `CRON_SECRET`, a long random value (`openssl rand -hex 32`),
   **Sensitive**, Production. Vercel Cron sends it as the bearer token by itself.
2. Redeploy. Under **Settings → Cron Jobs** the daily `/api/jobs/drain` job should be listed.

### 8b. Supabase (every 5 minutes)

Use the **same secret value** as Vercel's. Add it in **Integrations → Vault** (name `cron_secret`) rather than in
step 2's SQL: the SQL Editor keeps query history, so a pasted secret stays there in plain text. If you do run step 2,
delete that query from the history afterwards. Then run steps 1 and 3 in the **SQL Editor** of the production project;
the secret is read from Vault at run time, never stored in the cron job's SQL.

```sql
-- 1. Extensions (or Dashboard -> Integrations -> Cron / Database -> Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. The secret, in Vault
select vault.create_secret('<CRON_SECRET>', 'cron_secret', 'Bearer secret for /api/jobs/drain');

-- 3. Every 5 minutes (enough for retries; every minute only adds calls)
select cron.schedule(
  'drain-jobs',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://receipt-ocr.bhimraj.com.np/api/jobs/drain',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
```

`cron.schedule` with an existing name replaces that job, so re-running step 3 is safe. `vault.create_secret` is not:
the name is unique, so to change the secret use `vault.update_secret` (or edit it in the Vault UI). The job runs as a database role, so
it needs no key in the app.

**Check it works** (after a minute or two):

```sql
-- Did cron fire?
select start_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'drain-jobs')
order by start_time desc limit 10;

-- What did the app answer? (pg_net keeps responses for 6 hours)
select created, status_code, left(content, 200) as body, error_msg
from net._http_response order by created desc limit 10;
```

Expect `status_code` 200 and a body like `{"claimed":0,...}`. `401` means the Vault secret differs from Vercel's, or
`CRON_SECRET` isn't set on Vercel (an unset secret logs the `jobs.drain_unconfigured` notice; a wrong one logs a sampled `outcome: unauthorized`). A pg_net timeout on a call that ran close to 60 s can still be a successful drain. `cron.job_run_details` only says the
request was sent; the response is in `net._http_response`.

**Stop it** (pause, or if something goes wrong):

```sql
select cron.unschedule('drain-jobs');
-- later: remove the secret
delete from vault.secrets where name = 'cron_secret';
```

To pause the queue itself without touching cron, use **Admin → Jobs → Pause**: the drain keeps running but claims
nothing.

**Rotate** the secret: set the new value in Vercel, redeploy, then
`select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<new>');`. Calls fail with
`401` between the two steps; the next minute after both is fine.

**Later, with a worker:** the same code runs as a long-running process. A future `apps/worker` calls
`runWorkerLoop({ registry: JOB_REGISTRY, worker, budgetMs, stopClaimingBeforeMs, maxJobs, idleMs, signal })` from
`@receipt-ocr/core` on the shared runtime and aborts `signal` on SIGTERM. Keep the cron on as a fallback: whatever is
free does the work.

---

## 9. Optional extras

None of these is needed to run the app. Each is off until its variables are set; unset, its code isn't loaded and
it makes no network calls.

| Service              | What it adds                                        | Status                                                           |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Vercel Web Analytics | Cookie-free page counts on public pages             | **Works.** Vercel → Analytics → Enable; no variable              |
| Google Analytics 4   | Visitor analytics on public pages, after consent    | **Works.** Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` (9a)              |
| Axiom                | Searchable logs kept longer than Vercel's           | **Works.** Set `OTEL_EXPORTER_OTLP_ENDPOINT` and `_HEADERS` (9b) |
| Sentry               | Error grouping and alerts, server and browser       | **Works.** Set `SENTRY_DSN` (9c)                                 |
| PostHog              | Product analytics (funnels, retention), server-side | **Works.** Set `POSTHOG_KEY` and `POSTHOG_HOST` (9d)             |

Do them in this order when the time comes: Axiom first (logs are what you need during an incident), then Sentry, then
PostHog once there are users to learn from.

### 9a. Google Analytics 4

1. [analytics.google.com](https://analytics.google.com) → **Admin → Create → Property**. Name `ReceiptOCR`, your time
   zone and currency. Skip the business questions.
2. **Data collection → Data streams → Add stream → Web.** URL `https://receipt-ocr.bhimraj.com.np`, name `Production`.
   Copy the **Measurement ID** (`G-…`).
3. In the stream's **Enhanced measurement** settings, turn off **Page changes based on browser history events**. The
   app sends its own page views without query strings; GA's would send the full URL.
4. **Admin → Data settings → Data retention:** 2 months. Leave **Google signals** and ads links off.
5. Vercel: add `NEXT_PUBLIC_GA_MEASUREMENT_ID` (Production, **Config**, not Sensitive). It is read at build time, so
   redeploy ([step 7](#7-deploy-and-check)).
6. Check: open the site in a private window. A cookie banner appears; after **Accept**, GA → Reports → Realtime shows
   you. In `/app` nothing is sent.

### 9b. Axiom

1. [app.axiom.co](https://app.axiom.co) → sign up → **Datasets → New dataset** `receipt-ocr` (kind **Events**, which
   Axiom asks for OpenTelemetry logs).
2. **Settings → API tokens → New token**, with only **Ingest** on that dataset. Copy it (`xaat-…`).
3. Vercel (**Production only**, not Preview: previews would spend the query allowance):
   `OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co` (Config) and
   `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>,X-Axiom-Dataset=receipt-ocr` (Secret).
4. Redeploy. Events keep going to Vercel's logs too; Axiom gets the same events, already sampled and scrubbed. The
   privacy page then names Axiom as the log store (it reads the endpoint at build time).
5. Check: sign in and open `/app`, then open the dataset's **Stream** in Axiom: a `page.render` or request event appears within
   a few seconds. Nothing arriving: look in Vercel's logs for `telemetry.export_failed` (a wrong token or dataset) or
   `telemetry.start_failed`. The free Personal plan is US-only (the EU edge is paid). Optional:
   `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production` (Config).

### 9c. Sentry

1. [sentry.io](https://sentry.io) → **Create project → Next.js**, name `receipt-ocr`. Copy the **DSN**.
2. **Security & Privacy** and **Allowed Domains:** see [9e](#9e-provider-privacy-and-alert-settings) (the privacy page says IPs
   aren't stored).
3. Vercel (Production): `SENTRY_DSN` (Config). It is read at build too: the build inlines it into the browser code
   and adds Sentry's ingest host to the CSP, so redeploy after setting it. No `NEXT_PUBLIC_` copy is needed. A value
   that isn't a DSN (say, an auth token pasted by mistake) leaves Sentry off.
4. Alerts and quota protection: see [9e](#9e-provider-privacy-and-alert-settings).
5. Check: `curl -s https://<host>/api/health` shows the commit; issues carry the same 7-character release.

What is sent: server 5xx and defects (from `failureResponse` and `onRequestError`), uncaught exceptions, unhandled
rejections, dead jobs, and browser errors outside or inside error boundaries. Errors only: no tracing, Replay,
Feedback or Logs. Each event is rebuilt from an allowlist (see [observability](architecture/flows/observability.md#sentry)).

Not yet: source-map upload. Stack frames point at the built files. The planned step is a separate `sentry-cli`
upload in `production.yml` that runs no repo code, with `SENTRY_AUTH_TOKEN` as a GitHub Actions secret only (never
in Vercel), maps deleted before deploy (security plan M11). Docker: pass `--build-arg SENTRY_DSN=...` and
`--build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD)` to `docker/Dockerfile.prod` for browser reporting and the release;
`SENTRY_DSN` in the container's environment alone turns on server reporting only.

### 9d. PostHog

1. [posthog.com](https://posthog.com) → sign up, region **US** (or EU; it decides the host). Project `ReceiptOCR`.
2. **Billing:** stay on Free with no card: usage is hard-capped at the free allotment (1M events a month) and PostHog
   emails at 80% and 100%. If a card is ever added, set **Product analytics → billing limit $0** the same day.
3. Vercel (Production): `POSTHOG_KEY` (the project API key, stored as **Sensitive**: it is read on the server only,
   so it has no `NEXT_PUBLIC_` name) and `POSTHOG_HOST`
   (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
4. Redeploy: the privacy page names PostHog only when `POSTHOG_KEY` is set at build.
5. Check: sign up or upload a receipt, then **Activity** in PostHog shows `signed_up` or `receipt_uploaded` with the
   user's id as the person and no email or name.

Events (server-side only, `lib/telemetry/analytics.ts`): `signed_up` (`method`), `receipt_uploaded` (`mode`, `plan`),
`receipt_scanned` (`trigger`, `model`, `fallback`, `calls`), `receipt_scan_failed` (`trigger`, `error_kind`),
`csv_exported` (`count`), `plan_limit_hit` (`limit`: `day` or `minute`, `plan`; a user's first 3 a minute). Each
carries the user id, `workspace_id` as a plain prop (PostHog's `groups` need the paid group-analytics add-on) and the
`workspace` group. Nothing is sent for what an admin does while impersonating a user,
including the scans of receipts they upload. Browser PostHog (page views, landing-page funnels) needs a consent
decision first and is not built (see `docs/STATUS.md`).

### 9e. Provider privacy and alert settings

Set once per provider; recheck after creating a new project. Why each one, and the free-plan limits:
[observability on free plans](reviews/2026-11-08-observability-free-tier.md).

**Privacy** (done for production on 2026-11-08):

- [ ] **Sentry → Settings → Projects → receipt-ocr → Security & Privacy:** **Data Scrubber** on, **Use Default
      Scrubbers** on, **Prevent Storing of IP Addresses** on, **Additional Sensitive Fields** `email`. The same
      switches exist org-wide under **Settings → receiptocr → Security & Privacy**.
- [ ] **Sentry → Projects → receipt-ocr → Client Security → Allowed Domains:** `receipt-ocr.bhimraj.com.np` (not
      `*`); add staging domains as extra lines. Server-side events are unaffected (they send no `Origin` header).
      Keep **Enable JavaScript source fetching** on until source maps are uploaded.
- [ ] **PostHog → Settings → Project → Privacy → IP data capture configuration:** **Discard client IP data** on.
- [ ] **Vercel:** `POSTHOG_KEY` stored as **Sensitive** (server-only; no `NEXT_PUBLIC_` name, since there is no
      browser PostHog).

**Quota, alerts and dashboards** (O1 to O10 in the review):

- [ ] **Sentry → Settings → Projects → receipt-ocr → Inbound Filters:** on for browser extension errors, events
      from localhost, legacy browsers (all), web crawlers, React hydration errors, ChunkLoadErrors and health-check
      transactions. Filtered events don't count against the 5k a month.
- [ ] **Sentry → Settings → Spike Protection:** enable for receipt-ocr, add the Sentry Notification action, then
      **User Settings → Notifications → Spike Protection** on. It needs a month of baseline.
- [ ] **Sentry → Alerts → Create Alert → Issues:** "A new issue is created" OR "The issue changes state from
      resolved to unresolved", filter `environment` = `production`, email, every 30 minutes. Delete the default
      every-new-issue rule.
- [ ] **Sentry → Projects → receipt-ocr → Client Keys (DSN) → Configure:** Allowed Domains as above; **Rate limits**
      30 per minute if the field is editable on the free plan.
- [ ] **Axiom → Monitors → New → Threshold**, notifier Email (the free plan's 3; confirm the attribute path from
      one event in **Stream** first): server errors (`severity_text == "error"`, not `job.attempt`, ≥ 3 in 10 min,
      every 5 min); scans retrying (`job.attempt` with `queue.outcome` `retry` or `lost`, ≥ 5 in 15 min); OCR
      spend (`sum(ocr.cost_micro_usd)` ≥ 2,000,000 in 60 min, every 15 min).
- [ ] **Axiom:** `OTEL_EXPORTER_OTLP_*` in Vercel for Production only; dataset `receipt-ocr`, ingest-only token.
- [ ] **Axiom → Dashboards → "Ops"**, default range 24 h: requests by status class per 15 min, p95 `duration_ms`
      by route, scans by `queue.outcome` per hour, p50/p95 `timings_ms.ai.extract` by `ocr.model`, OCR spend per
      hour. Check **Settings → Usage** monthly (10 GB-hours of query compute is the binding limit).
- [ ] **PostHog → Organization → Billing:** no card (see 9d).
- [ ] **PostHog → Dashboards → "Founder weekly"**, last 30 days: activation funnel `signed_up` → `receipt_uploaded`
      → `receipt_scanned` → `csv_exported` (7-day window, breakdown by `method`), weekly active uploaders, 8-week
      `receipt_uploaded` retention, `plan_limit_hit` by `plan`. **⋯ → Subscribe**, weekly, Monday morning.
- [ ] **Uptime:** a free external check (UptimeRobot, Better Stack or similar) on `GET /api/health/ready` every
      5 minutes, email after 2 failures. Healthy answers aren't logged, so the pinger costs no log volume.

---

## Preview environment

Pull-request previews use the staging database, so give them their own storage and keys too. Otherwise test uploads
land in the production bucket, and a leaked preview key reaches production. In Vercel, add each of these with only
**Preview** ticked.

| Key                            | Value for Preview                                                     | Kind   | Notes                                         |
| ------------------------------ | --------------------------------------------------------------------- | ------ | --------------------------------------------- |
| `S3_ENDPOINT`                  | Same as Production (one Cloudflare account)                           | Config |                                               |
| `S3_REGION`                    | `auto`                                                                | Config |                                               |
| `S3_BUCKET`                    | `receipt-ocr-staging`                                                 | Config |                                               |
| `S3_ACCESS_KEY_ID`             | From a second R2 token limited to `receipt-ocr-staging` only          | Secret | Never reuse the Production token              |
| `S3_SECRET_ACCESS_KEY`         | From that token                                                       | Secret |                                               |
| `GOOGLE_GENERATIVE_AI_API_KEY` | A separate key, ideally in its own Google project with a small budget | Secret |                                               |
| `ANTHROPIC_API_KEY`            | A key from a preview workspace with a low spend limit                 | Secret | Optional                                      |
| `RESEND_API_KEY`               | A separate key                                                        | Secret | Optional; send only to `delivered@resend.dev` |
| `EMAIL_FROM`, `SUPPORT_EMAIL`  | Same as Production                                                    | Config |                                               |
| `DATABASE_URL`                 | The **staging** database's transaction pooler URL                     | Secret | Already set                                   |
| `BETTER_AUTH_SECRET`           | Its own secret, never Production's                                    | Secret | Already set                                   |
| `OCR_DAILY_CAP`                | `50`                                                                  | Config | Already set                                   |

Leave out for Preview: `BETTER_AUTH_URL` (previews use their own address), the Google and GitHub sign-in keys
(callback URLs can't match random preview addresses). For Turnstile, use the test keys in [step 6](#6-bot-protection-turnstile). Previews are
behind Vercel Deployment Protection, so only the team can open them.

---

## Domains

| Domain                               | What it does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `receipt-ocr.bhimraj.com.np`         | Production                                            |
| `receiptocr.vercel.app`              | 308 redirect to production                            |
| `preview.receipt-ocr.bhimraj.com.np` | Fixed preview: branch domain for git branch `preview` |
| `preview-receipt-ocr.vercel.app`     | Same, on a Vercel address                             |

**The `preview` branch.** Pushing to `preview` runs the Preview workflow, which deploys and points both preview
domains at the new deployment. To refresh it with any branch: `git push origin <branch>:preview` (add `--force-with-lease`
if it isn't a fast-forward). It uses the staging database and the Preview variables, and sits behind Vercel Deployment
Protection. Only the owner should push to `preview`; add a branch rule for it later. Every non-production deployment
sends `X-Robots-Tag: noindex` and a disallow-all `robots.txt`.

Google and GitHub sign-in stay off on Preview (owner decision): leave their variables unset there and use email and
password.

---

## Already set

These were set when the project was created. Listed so a new environment doesn't miss them.

| Key                   | What                                                                | Kind   |
| --------------------- | ------------------------------------------------------------------- | ------ |
| `DATABASE_URL`        | Supabase connection (transaction pooler, port 6543)                 | Secret |
| `BETTER_AUTH_SECRET`  | Signs sessions: `openssl rand -base64 32`, one per environment      | Secret |
| `BETTER_AUTH_SECRETS` | Optional, for rotating the secret: `1:<current secret>`             | Secret |
| `BETTER_AUTH_URL`     | `https://receipt-ocr.bhimraj.com.np` (Production only)              | Config |
| `ADMIN_EMAILS`        | Who becomes admin on sign-up, comma-separated                       | Config |
| `LOG_SAMPLE_RATE`     | `0.1`: keep 10% of routine logs (Production)                        | Config |
| `OCR_DAILY_CAP`       | `200` Production, `50` Preview                                      | Config |
| `CRON_SECRET`         | Bearer secret for `/api/jobs/drain` ([step 8](#8-queue-drain-cron)) | Secret |

Two-step sign-in and "confirm it's you" need nothing new: they use `BETTER_AUTH_SECRET(S)` and the mailer above.
`ADMIN_MFA_ENFORCE` exists only as an emergency off switch for the admin requirement (see
[deployment.md](deployment.md#admin-locked-out-of-two-step-sign-in)); leave it unset. Passkeys take their relying-party id from `BETTER_AUTH_URL`'s host (`receipt-ocr.bhimraj.com.np`), so nothing new there either.

`DIRECT_URL` (for database migrations) never goes to Vercel. It lives in the `staging-db` and `production-db`
GitHub environments, used only by the **Database Migration** workflow.

Every variable is also explained in `apps/web/.env.example`, and [deployment.md](deployment.md#4-environment-variables)
has the full reference.

## From a terminal

The owner's Codespace has a helper that pushes values from a private file, skips empty ones and never prints a value:
`python3 ~/receipt-ocr-push-vercel.py prod` to preview, then add `--apply`. It isn't part of the repository.
