# Setting up environment variables on Vercel

A step-by-step for a new Vercel environment (Production, Preview, or a new project). It goes in the order that makes
the app usable: storage, then OCR, then email. Every variable is explained in `apps/web/.env.example`, and
[deployment.md](deployment.md#4-environment-variables) has the full table.

Where to add them: Vercel → project → **Settings → Environment Variables → Add**. For each one, set:

- **Key** and **Value**.
- **Environments**: tick **Production** for the live site, **Preview** for PR previews (which use the staging
  database and their own keys). Development isn't used.
- **[Secret]**: turn on **Sensitive**. The value can never be read back, not even by you, so keep a copy in your
  password manager. **[Config]**: leave Sensitive off. These values aren't secret, and seeing them helps debugging.

Nothing changes until the next deploy: run **Vercel Production Deployment** from the Actions tab (or redeploy in
Vercel). Then check `https://<your domain>/api/health/ready`.

A variable that is set but wrong is worse than one that's unset: the app then believes a provider or mailer is ready.
Leave a variable out until you have its real value.

## 1. Storage: Cloudflare R2 (required: uploads fail without it)

In Cloudflare:

1. **R2 Object Storage → Create bucket.** Production: `receipt-ocr`. Preview: `receipt-ocr-staging`. Location hint:
   Eastern North America (Vercel functions run in `iad1`). Keep it private (no public access, no custom domain);
   images are served through short-lived signed URLs, so no CORS rule is needed.
2. **R2 → Manage API tokens → Create API token.** Permission **Object Read & Write**, **Apply to specific buckets
   only**: the one bucket. One token per bucket, so a leaked Preview token can't touch production. Copy the values it
   shows; the secret is shown once.

In Vercel:

| Key                    | Value                                                        | Type     |
| ---------------------- | ------------------------------------------------------------ | -------- |
| `S3_ENDPOINT`          | `https://<account-id>.r2.cloudflarestorage.com`              | [Config] |
| `S3_REGION`            | `auto`                                                       | [Config] |
| `S3_BUCKET`            | `receipt-ocr` (Production) / `receipt-ocr-staging` (Preview) | [Config] |
| `S3_ACCESS_KEY_ID`     | The token's Access Key ID (32 hex characters)                | [Secret] |
| `S3_SECRET_ACCESS_KEY` | The token's Secret Access Key (64 hex characters)            | [Secret] |

Leave `S3_FORCE_PATH_STYLE` unset: R2 accepts path-style requests, which is the default. Check: `/api/health/ready`
shows `"storage":"ok"`.

## 2. OCR: AI provider keys (required: nothing is read without one)

**Gemini** (the default chain). In [Google AI Studio](https://aistudio.google.com), **Get API key**, in a Google Cloud
project **with billing enabled**: on the free tier Google may use the content, and receipts are personal data.

| Key                            | Value   | Type     |
| ------------------------------ | ------- | -------- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `AIza…` | [Secret] |

**Claude** (optional second provider). In the [Anthropic Console](https://console.anthropic.com), create a workspace
for this app with a monthly spend limit, then an API key inside it. Use a separate key per environment, never a
personal or development key.

| Key                 | Value      | Type     |
| ------------------- | ---------- | -------- |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | [Secret] |

Then **Admin → Settings → OCR models**: each provider shows "API key set" once its key is there. Choose and order the
models. Keys are never entered or shown in the admin UI.

Spend guards, optional: `OCR_DAILY_CAP` (rounds per UTC day across all users, e.g. `200`) and
`OCR_MONTHLY_BUDGET_USD` (e.g. `50`), both [Config].

## 3. Email: Resend (required: sign-up verification needs it)

In [Resend](https://resend.com):

1. **Domains → Add domain**, e.g. `bhimraj.com.np` (or a subdomain such as `mail.bhimraj.com.np`, which keeps the
   main domain's mail records separate). Add the DNS records it lists (SPF and DKIM) at your DNS provider, then
   **Verify**.
2. **API Keys → Create API key**, permission **Sending access**, limited to that domain. One key per environment.

| Key              | Value                                             | Type     |
| ---------------- | ------------------------------------------------- | -------- |
| `RESEND_API_KEY` | `re_…`                                            | [Secret] |
| `EMAIL_FROM`     | `receiptOCR <receipt-ocr@bhimraj.com.np>`         | [Config] |
| `SUPPORT_EMAIL`  | `receipt-ocr@bhimraj.com.np` (support-form inbox) | [Config] |

`EMAIL_FROM` must use the verified domain. Mail is sent only when both `RESEND_API_KEY` and `EMAIL_FROM` are set.
For Preview, send only to Resend's test addresses (`delivered@resend.dev`).

## 4. Already set by the first deploy

These are in place on this project; listed so a new environment doesn't miss them.

| Key                    | Value                                                  | Type     |
| ---------------------- | ------------------------------------------------------ | -------- |
| `DATABASE_URL`         | Supabase **transaction pooler** URL (port 6543)        | [Secret] |
| `BETTER_AUTH_SECRET`   | `openssl rand -base64 32`, different per environment   | [Secret] |
| `BETTER_AUTH_SECRETS`  | Optional rotation list, `1:<current secret>`           | [Secret] |
| `BETTER_AUTH_URL`      | `https://receipt-ocr.bhimraj.com.np` (Production only) | [Config] |
| `NEXT_PUBLIC_SITE_URL` | Same origin                                            | [Config] |
| `ADMIN_EMAILS`         | Comma-separated admin emails (Production)              | [Config] |
| `LOG_SAMPLE_RATE`      | `0.1` (Production)                                     | [Config] |

`DIRECT_URL` never goes to Vercel: only the **Database Migration** workflow uses it, from the `staging-db` and
`production-db` GitHub environments.

## 5. Optional

**Social sign-in.** A provider appears only when both of its values are set. Callback URL:
`https://<your domain>/api/auth/callback/<google|github>`. Production only: Preview hosts change per PR.

| Key                                        | Type               |
| ------------------------------------------ | ------------------ |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Config], [Secret] |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | [Config], [Secret] |

**Bot protection (Cloudflare Turnstile).** Set both or neither: the app refuses to start with one. The site key is
built into the page, so it needs a new build.

| Key                              | Type     |
| -------------------------------- | -------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | [Config] |
| `TURNSTILE_SECRET_KEY`           | [Secret] |

**Analytics.** `NEXT_PUBLIC_GA_MEASUREMENT_ID` ([Config], build time). See
[Analytics and cookie consent](deployment.md#analytics-and-cookie-consent).

## From a terminal instead

The owner's Codespace has a helper that pushes filled-in values from a private file, skips empty ones and never
prints a value: `python3 ~/receipt-ocr-push-vercel.py prod` (dry run), then `--apply`. It isn't in the repository.
