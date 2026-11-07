# Setting up environment variables on Vercel

A step-by-step for a new Vercel environment (Production, Preview, or a new project). It goes in the order that makes
the app usable: storage, then OCR, then email, then the optional extras. Every variable is explained in
`apps/web/.env.example`, and [deployment.md](deployment.md#4-environment-variables) has the full table. Each provider's
console steps are in a collapsed block: open the one you're working on.

Where to add them: Vercel → project → **Settings → Environment Variables → Add**. For each one, set:

- **Key** and **Value**.
- **Environments**: tick **Production** for the live site, **Preview** for PR previews (which use the staging
  database and their own keys). Development isn't used.
- **[Secret]**: turn on **Sensitive**. The value can never be read back, not even by you, so keep a copy in your
  password manager. **[Config]**: leave Sensitive off. These values aren't secret, and seeing them helps debugging.

Nothing changes until the next deploy: run **Vercel Production Deployment** from the Actions tab (or redeploy in
Vercel). Then check `https://<your domain>/api/health/ready`.

A variable that is set but wrong is worse than one that's unset: the app then believes a provider or mailer is ready.
Leave a variable out until you have its real value. Use separate keys for Production and Preview everywhere, so a
leaked preview key can't touch production.

Console screens change; if a button has moved, the provider's own docs (linked in each block) are the reference.

## 1. Storage: Cloudflare R2 (required: uploads fail without it)

<details>
<summary><b>Create the bucket and token in Cloudflare</b></summary>

Docs: [R2 buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/),
[R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/).

1. Cloudflare dashboard → **R2 Object Storage** (enable R2 on the account the first time; it asks for a payment
   method even on the free allowance).
2. **Create bucket.** Production: `receipt-ocr`. Preview: `receipt-ocr-staging`. Location hint: **Eastern North
   America** (Vercel functions run in `iad1`). Leave public access off and add no custom domain: images are served
   through short-lived signed URLs, so no CORS rule is needed either.
3. Note the **Account ID** (R2 overview page, right side). The endpoint is
   `https://<account-id>.r2.cloudflarestorage.com`.
4. **R2 → Manage API tokens → Create API token.**
   - Permissions: **Object Read & Write**.
   - Specify bucket(s): **Apply to specific buckets only**, and pick the one bucket.
   - TTL: forever, or a date you'll remember to rotate on.
5. **Create**, then copy the **Access Key ID** and **Secret Access Key**. The secret is shown once.
6. Repeat 4–5 for the other bucket, so each environment has its own token.

</details>

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

### Gemini (the default chain)

<details>
<summary><b>Create a paid Gemini API key in Google</b></summary>

Docs: [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key),
[billing](https://ai.google.dev/gemini-api/docs/billing).

Use a **paid** key: on the free tier Google may use prompts and images to improve its products, and receipts are
personal data.

1. [Google Cloud Console](https://console.cloud.google.com) → create a project for this app (e.g. `receipt-ocr`), or
   pick the existing one. One project per environment if you want separate keys and bills.
2. **Billing** → link a billing account to the project.
3. [Google AI Studio](https://aistudio.google.com) → **Get API key → Create API key** → choose that project. The key
   list should show the project on the **paid** tier; if it says free, check step 2.
4. Restrict the key: Cloud Console → **APIs & Services → Credentials** → the key → **API restrictions → Restrict
   key** → **Generative Language API** only. (Leave application restrictions at none: the calls come from Vercel's
   servers, whose IPs change.)
5. Optional, recommended: **Billing → Budgets & alerts** → a monthly budget with email alerts at 50% / 90% / 100%.

</details>

| Key                            | Value   | Type     |
| ------------------------------ | ------- | -------- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `AIza…` | [Secret] |

### Claude (optional second provider)

<details>
<summary><b>Create an Anthropic API key with a spend limit</b></summary>

Docs: [Anthropic Console](https://console.anthropic.com), [workspaces](https://docs.anthropic.com/en/api/workspaces).

1. Console → **Settings → Workspaces → Create workspace** (e.g. `receipt-ocr-production`; another for preview).
2. In the workspace → **Limits** → set a **monthly spend limit**. Requests fail cleanly when it's reached, and the
   app falls back to the next model in the chain.
3. **API keys → Create key** inside that workspace. Copy it; it's shown once.
4. Never reuse a personal or development key here.

</details>

| Key                 | Value      | Type     |
| ------------------- | ---------- | -------- |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | [Secret] |

Then **Admin → Settings → OCR models**: each provider shows "API key set" once its key is there. Choose and order the
models. Keys are never entered or shown in the admin UI.

Spend guards, optional: `OCR_DAILY_CAP` (rounds per UTC day across all users, e.g. `200`) and
`OCR_MONTHLY_BUDGET_USD` (e.g. `50`), both [Config].

## 3. Email: Resend (required: sign-up verification needs it)

<details>
<summary><b>Verify the domain and create a key in Resend</b></summary>

Docs: [Resend domains](https://resend.com/docs/dashboard/domains/introduction),
[API keys](https://resend.com/docs/dashboard/api-keys/introduction).

1. [Resend](https://resend.com) → **Domains → Add domain**: `bhimraj.com.np`, or a subdomain such as
   `mail.bhimraj.com.np` (keeps this app's mail records apart from the main domain's). Region: the one nearest the
   users, or us-east-1 next to Vercel.
2. Add the DNS records it lists at your DNS provider: the DKIM `TXT`, and the SPF `MX` + `TXT` on the `send`
   subdomain. Optional but recommended: a DMARC `TXT` at `_dmarc` (e.g. `v=DMARC1; p=none;`).
3. **Verify DNS records**; wait until the domain shows **Verified** (minutes, sometimes hours).
4. **API Keys → Create API key**: permission **Sending access**, domain: the one above. One key per environment.

</details>

| Key              | Value                                             | Type     |
| ---------------- | ------------------------------------------------- | -------- |
| `RESEND_API_KEY` | `re_…`                                            | [Secret] |
| `EMAIL_FROM`     | `receiptOCR <receipt-ocr@bhimraj.com.np>`         | [Config] |
| `SUPPORT_EMAIL`  | `receipt-ocr@bhimraj.com.np` (support-form inbox) | [Config] |

`EMAIL_FROM` must use the verified domain. Mail is sent only when both `RESEND_API_KEY` and `EMAIL_FROM` are set.
For Preview, send only to Resend's test addresses (`delivered@resend.dev`). `SUPPORT_EMAIL` must be a real inbox you
read (Resend only sends; receiving needs a mailbox or forwarding, e.g. Cloudflare Email Routing).

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

### Sign in with Google

<details>
<summary><b>Create the OAuth client in Google Cloud</b></summary>

Docs: [Google Auth Platform](https://support.google.com/cloud/answer/15544987),
[Better Auth: Google](https://www.better-auth.com/docs/authentication/google).

1. [Google Cloud Console](https://console.cloud.google.com) → the app's project → **Google Auth Platform** (formerly
   "OAuth consent screen") → **Get started**.
2. **Branding**: app name `receiptOCR`, user support email, logo (optional; a logo triggers Google's brand review),
   home page `https://receipt-ocr.bhimraj.com.np`, privacy policy `…/privacy`, terms `…/terms`, and authorised domain
   `bhimraj.com.np`.
3. **Audience**: **External**. While it's in **Testing**, only listed test users can sign in; **Publish app** to
   open it to everyone. The scopes used (`openid`, `email`, `profile`) are non-sensitive, so publishing needs no
   Google verification beyond the branding check.
4. **Data access**: add the scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
5. **Clients → Create client** → type **Web application**:
   - Authorised JavaScript origins: `https://receipt-ocr.bhimraj.com.np`
   - Authorised redirect URIs: `https://receipt-ocr.bhimraj.com.np/api/auth/callback/google`
6. **Create**, then copy the **Client ID** and **Client secret** (download the JSON if you want a backup; the secret
   may not be shown again).

Production only: preview hosts change per PR, and Google needs every redirect URI listed.

</details>

| Key                    | Value                                   | Type     |
| ---------------------- | --------------------------------------- | -------- |
| `GOOGLE_CLIENT_ID`     | `1234…-abc….apps.googleusercontent.com` | [Config] |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-…`                              | [Secret] |

### Sign in with GitHub

<details>
<summary><b>Create the OAuth app in GitHub</b></summary>

Docs: [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app),
[Better Auth: GitHub](https://www.better-auth.com/docs/authentication/github).

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (an organisation's settings work too).
2. Application name `receiptOCR`, homepage `https://receipt-ocr.bhimraj.com.np`, authorization callback URL
   `https://receipt-ocr.bhimraj.com.np/api/auth/callback/github`. Leave device flow off.
3. **Register application** → copy the **Client ID** → **Generate a new client secret** and copy it (shown once).
4. Optional: upload a logo so the consent screen looks trustworthy.

</details>

| Key                    | Value     | Type     |
| ---------------------- | --------- | -------- |
| `GITHUB_CLIENT_ID`     | `Ov23li…` | [Config] |
| `GITHUB_CLIENT_SECRET` | 40 hex    | [Secret] |

A provider's button appears only when both of its values are set.

### Bot protection: Cloudflare Turnstile

<details>
<summary><b>Create the Turnstile widget in Cloudflare</b></summary>

Docs: [Turnstile get started](https://developers.cloudflare.com/turnstile/get-started/).

1. Cloudflare dashboard → **Turnstile → Add widget**.
2. Name `receipt-ocr`, hostnames `receipt-ocr.bhimraj.com.np` (add a preview host only if previews should use it;
   otherwise leave Preview without Turnstile or give it Cloudflare's test keys).
3. Widget mode **Managed**. Pre-clearance: no.
4. **Create**, then copy the **Site key** and **Secret key**.

</details>

| Key                              | Value         | Type     |
| -------------------------------- | ------------- | -------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `0x4AAAAAAA…` | [Config] |
| `TURNSTILE_SECRET_KEY`           | `0x4AAAAAAA…` | [Secret] |

Set both or neither: the app refuses to start with one. The site key is built into the page, so it takes effect only
after a new build. More in [Bot protection](deployment.md#bot-protection-turnstile).

### Analytics

`NEXT_PUBLIC_GA_MEASUREMENT_ID` ([Config], build time). See
[Analytics and cookie consent](deployment.md#analytics-and-cookie-consent).

## From a terminal instead

The owner's Codespace has a helper that pushes filled-in values from a private file, skips empty ones and never
prints a value: `python3 ~/receipt-ocr-push-vercel.py prod` (dry run), then `--apply`. It isn't in the repository.
