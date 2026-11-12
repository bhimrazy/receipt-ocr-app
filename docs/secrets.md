# Secrets: Infisical as the one place they live

Today the secrets are spread over Vercel (Sensitive values can't be read back), GitHub Actions secrets, the repo's
`.env` and two files in the Codespace home (`~/.receipt-ocr-prod.env`, `~/.receipt-ocr-staging.env`). The goal is one
copy in Infisical, synced out to Vercel, and no secret files left in the Codespace.

## Layout

One Infisical project, `receipt-ocr`, with Infisical's default environments (Development, Staging, Production) and one folder for operator tokens.

| Infisical environment | Source to import from today  | Syncs to              | Notes                                |
| --------------------- | ---------------------------- | --------------------- | ------------------------------------ |
| `prod`                | `~/.receipt-ocr-prod.env`    | Vercel **Production** | Live site                            |
| `staging`             | `~/.receipt-ocr-staging.env` | Vercel **Preview**    | PR previews and the staging database |
| `dev`                 | The repo's `.env` (app keys) | Nothing; read locally | Local development                    |
| `dev`, folder `/ops`  | The repo's `.env` (tokens)   | Nothing; read locally | Tooling, not the app (see below)     |

Operator tokens (`/ops`): `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `GITHUB_TOKEN`,
`SENTRY_AUTH_TOKEN`, `SENTRY_READ_TOKEN`, `AXIOM_TOKEN`. They act on the accounts, not inside the app, so they never
sync to Vercel. Infisical doesn't sync to Vercel on its own today: a new app variable (for example `DATABASE_SSL_CA`,
added 2026-11-09) goes into both Infisical and Vercel.

Build-time values (`NEXT_PUBLIC_*`, `SENTRY_DSN`, `POSTHOG_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`) must stay
**not Sensitive** in Vercel ([why](production-environment.md#how-to-add-a-variable)). Keep them in Infisical like the
rest; the sync must not mark them Sensitive.

## One-time setup (about 30 minutes)

1. **Account and project.** Sign up at [infisical.com](https://infisical.com) (Infisical Cloud; check that the free plan
   covers one project with three environments). Turn on MFA. Create the project `receipt-ocr`; it comes with Development (`dev`),
   Staging (`staging`) and Production (`prod`). Add the folder `/ops` in Development.
2. **Import the local files.** Sources: `prod` from `~/.receipt-ocr-prod.env`, `staging` from
   `~/.receipt-ocr-staging.env`, `dev` from the repo's `.env` (operator tokens into `/ops`). Two ways:
   - **By hand:** open the environment, then paste the file into the "Add a secret name or paste a .env" row (or
     drag the file onto the table).
   - **By an agent, over the API** (no CLI install). Give it a short-lived machine identity:
     1. Organization menu (not Settings) → **Access Control → Machine Identities → Create**: name
        `codespace-import`, organization role **Member**.
     2. On its page, Universal Auth is on by default: **Add Client Secret** (TTL 1 day), copy the Client ID and
        Client Secret.
     3. Project `receipt-ocr` → **Access Control → Machine Identities → Add Machine Identity to Project → Assign
        Existing**, role **Developer**.
     4. Put `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` and `INFISICAL_PROJECT_ID` (project Settings, or the
        project URL) in the repo's `.env` yourself, so they never pass through a chat.
     5. The agent logs in with Universal Auth, creates the secrets per environment and path without printing values
        and without overwriting existing keys, and reports key names and counts.
     6. Afterwards, revoke the client secret (or delete the identity). Create a separate read-only identity if CI needs
        one later.
   - Values that exist only in Vercel as Sensitive can't be imported from Vercel; they come from these files or from
     each service's dashboard.
3. **Check for gaps.** Compare each Infisical environment's key list with Vercel's (Settings → Environment
   Variables) and with [production-environment.md](production-environment.md). Anything only in Vercel (Paddle,
   `CRON_SECRET`, `BETTER_AUTH_SECRET(S)`, storage) has to be re-entered from its source or rotated.
4. **Sync to Vercel.** Project → **Integrations → Secret Syncs → Add Sync → Vercel**: connect Vercel, pick the
   `receipt-ocr` app, map `prod` → Production and `staging` → Preview.
   - Initial sync: **Import Secrets (Prioritize Infisical)**, not Overwrite, until step 3 shows no gaps.
   - Turn on **Disable Secret Deletion** for the first weeks, so a missing key in Infisical can't delete one in
     Vercel.
   - Check after the first sync that the build-time keys above are still not Sensitive.
5. **Prove it, then delete the files.** Change a harmless value (for example `LOG_SAMPLE_RATE` in `staging`), confirm
   it reaches Vercel, revert. Then delete `~/.receipt-ocr-prod.env`, `~/.receipt-ocr-staging.env` and the secret
   lines in the repo's `.env`.

## Working without `.env`

Install the Infisical CLI (outside the project, so the owner installs it), then once per machine:

```bash
infisical login      # browser login
infisical init       # in the repo root; writes .infisical.yaml (project id only, safe to commit)
```

Run anything with the secrets injected as environment variables, never written to disk:

```bash
infisical run --env=dev -- bun run dev
infisical run --env=dev --path=/ops -- gh workflow run production.yml
infisical run --env=prod -- bun dbcheck.ts     # scripts read process.env instead of a file
```

The CLI is renaming its commands (`infisical secrets-manager …`, alias `sm`); if a command above is rejected, check
`infisical --help`. Avoid `infisical export` to a file: that recreates the file we're getting rid of.

## Where it stands (2026-11-08)

Imported: Development `/` 15 and `/ops` 5, Staging 15, Production 32: the local files, every non-Sensitive value read
from Vercel's API, and production keys found in the repo's `.env` (GitHub client secret, Paddle API key and webhook
secret, Gemini, Anthropic, Groq; their comments say where they came from). The local production and staging files are
deleted.

**Pending**: 15 values that are Sensitive in Vercel (unreadable) and weren't in any local file. Each is a placeholder
`PENDING` in a `/pending` folder (Production 9, Staging 6), with a comment saying where to get it. `/pending` is
outside the synced path `/`, so a placeholder can never reach Vercel. To fill one: get the value, set it, move the
secret to `/`, delete the placeholder.

| Group                   | Keys                                                      | How                                                                              |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Readable in a dashboard | `GOOGLE_CLIENT_ID`, `S3_ENDPOINT`, `TURNSTILE_SECRET_KEY` | Copy                                                                             |
| New key, revoke old     | R2 token pair, Axiom ingest token                         | Create, put in Infisical and Vercel, redeploy, then revoke the old one           |
| New client secret       | `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`            | Add a second secret in the provider, deploy it, delete the old                   |
| Generate                | `CRON_SECRET`                                             | `openssl rand -hex 32`; set in Vercel and in the Supabase `pg_cron` job together |
| Auth secret             | `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`               | See below                                                                        |

**Auth secret.** The live value can't be read back, so it can't be kept as an old version in `BETTER_AUTH_SECRETS`.
A fresh secret signs everyone out and makes anything encrypted with the old one unreadable: authenticator (2FA)
secrets and encrypted OAuth tokens, so those users re-enrol 2FA and re-link. Acceptable before launch (the data is
disposable); after launch, rotate only with the old value in hand ([how](deployment.md#rotating-the-auth-secret)).
Until then, the live value stays in Vercel and nothing is lost by waiting.

**Syncing to Vercel.** Turn it on only when `/pending` is empty, with "Import Secrets (Prioritize Infisical)" and
**Disable Secret Deletion**. Never "Overwrite Destination Secrets" while anything is missing: it deletes Vercel
variables that Infisical lacks, which takes production down.

## Operator tokens: how to create each one

Tokens that act on the accounts, not inside the app. They live in Infisical `dev` → `/ops` and, for local work, the
repo's `.env` (gitignored). Give each the smallest scope that works and an expiry; note the expiry date in Infisical's
comment. Check a token by calling the API and looking only at the status code, never by printing it.

| Token                             | Used for                                                                                                    | Create it                                                                                                                                                                                                                                                                                                                                                                                     | Permissions                                                                                                                                                             | Expiry                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN` (local)            | Reading env var names, deployments and runtime logs                                                         | vercel.com/account/settings/tokens → **Create Token**                                                                                                                                                                                                                                                                                                                                         | **Scope:** the `receipt-ocr-workspace` team (not "Full Account")                                                                                                        | 90 days                                                                                                           |
| `VERCEL_TOKEN` (GitHub Actions)   | `preview.yml`, `vercel-cleanup.yml` and `production.yml` deploys                                            | Same page, a **separate** token named `github-actions`, saved as the secret `VERCEL_TOKEN` (with `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) in the GitHub environments `vercel` and `vercel-production` ([which is which](deployment.md#5-deploy)). A second token, `github-actions-production`, for `vercel-production` lets either be revoked alone                                              | Team scope                                                                                                                                                              | 1 year, with a calendar reminder                                                                                  |
| `SUPABASE_ACCESS_TOKEN`           | Management API: read-only SQL checks (`read_only: true`), logs, project settings                            | supabase.com/dashboard/account/tokens → **Generate new token**                                                                                                                                                                                                                                                                                                                                | Account-wide (Supabase has no narrower personal token); use it only for read-only checks                                                                                | Set one if offered; else rotate every 90 days                                                                     |
| `SENTRY_AUTH_TOKEN`               | Source-map upload (`sentry-cli sourcemaps upload`, which also creates the release) in `production.yml` only | Sentry → **Settings → Developer Settings → Organization Tokens** → **Create New Token** (an org auth token, `sntrys_…`; not a personal token, which stops working when its creator leaves the org). Store it as the secret `SENTRY_AUTH_TOKEN` of the GitHub environment `vercel-production` (main only; never `vercel`, which PR runs read) and in Infisical `dev` → `/ops`; never in Vercel | Org tokens have one fixed scope, `org:ci`: create releases and upload source maps and artifact bundles for the org's projects; no reading issues or events, no settings | Yearly, or at once if a run may have leaked it: create the new token, update both places, then revoke the old one |
| `SENTRY_READ_TOKEN`               | Reading issues and events when debugging                                                                    | sentry.io/settings/account/api/auth-tokens/ → **Create New Token**                                                                                                                                                                                                                                                                                                                            | `org:read`, `project:read`, `event:read` only                                                                                                                           | 90 days                                                                                                           |
| `AXIOM_TOKEN`                     | Sending logs (the app's ingest token)                                                                       | Axiom → **Settings → API tokens** → **New API token**                                                                                                                                                                                                                                                                                                                                         | Ingest into dataset `receipt-ocr` only; it can't query                                                                                                                  | Rotate yearly                                                                                                     |
| `AXIOM_QUERY_TOKEN` (optional)    | Reading logs when debugging                                                                                 | Same page, a second token                                                                                                                                                                                                                                                                                                                                                                     | Query dataset `receipt-ocr` only                                                                                                                                        | 90 days                                                                                                           |
| `GITHUB_TOKEN`                    | Dispatching and re-running workflows from the Codespace                                                     | github.com/settings/personal-access-tokens → **Fine-grained token**, repository `bhimrazy/receipt-ocr-app` only                                                                                                                                                                                                                                                                               | Actions: read and write; Contents: read; Metadata: read                                                                                                                 | 30–90 days (current one: 2026-11-14)                                                                              |
| `INFISICAL_CLIENT_ID` / `_SECRET` | One-off imports over the API                                                                                | See [one-time setup](#one-time-setup-about-30-minutes), step 2                                                                                                                                                                                                                                                                                                                                | Project role Developer                                                                                                                                                  | Client secret TTL 1 day; delete the identity after use                                                            |

When a token stops working:

- **Vercel "re-authenticate to this scope"**: the token was created before the team required a fresh login, or under
  "Full Account". Create a new team-scoped one.
- **Supabase or Sentry "invalid token" / "no permission"**: revoked, expired, or (Sentry) an organization token used
  for reading. Create the right kind from the table.
- **After rotating `VERCEL_TOKEN` for CI**, update it in each GitHub environment that holds it, or the next deploy fails. For
  `SENTRY_AUTH_TOKEN` (the `vercel-production` environment secret), an old or revoked token only fails the upload: the
  deploy goes on with a warning and minified stack traces.

## Rotating a key

Change it in the service, paste the new value into Infisical, let the sync push it, redeploy
([step 7](production-environment.md#7-deploy-and-check)), then revoke the old one in the service. The 2026-11-08
Resend change followed this order.

## CI

GitHub Actions keeps its own repository secrets for now. Moving them to Infisical (a machine identity with universal
auth, read-only on `prod`) is optional and only worth it once more than one place needs the same value.
