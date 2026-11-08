# Secrets: Infisical as the one place they live

Today the secrets are spread over Vercel (Sensitive values can't be read back), GitHub Actions secrets, the repo's
`.env` and two files in the Codespace home (`~/.receipt-ocr-prod.env`, `~/.receipt-ocr-staging.env`). The goal is one
copy in Infisical, synced out to Vercel, and no secret files left in the Codespace.

## Layout

One Infisical project, `receipt-ocr`, with three environments and one folder for operator tokens.

| Infisical environment | Source to import from today  | Syncs to              | Notes                                |
| --------------------- | ---------------------------- | --------------------- | ------------------------------------ |
| `prod`                | `~/.receipt-ocr-prod.env`    | Vercel **Production** | Live site                            |
| `staging`             | `~/.receipt-ocr-staging.env` | Vercel **Preview**    | PR previews and the staging database |
| `dev`                 | The repo's `.env` (app keys) | Nothing; read locally | Local development                    |
| `dev`, folder `/ops`  | The repo's `.env` (tokens)   | Nothing; read locally | Tooling, not the app (see below)     |

Operator tokens (`/ops`): `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `GITHUB_TOKEN`, `SENTRY_AUTH_TOKEN`,
`AXIOM_TOKEN`. They act on the accounts, not inside the app, so they never sync to Vercel.

Build-time values (`NEXT_PUBLIC_*`, `SENTRY_DSN`, `POSTHOG_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`) must stay
**not Sensitive** in Vercel ([why](production-environment.md#how-to-add-a-variable)). Keep them in Infisical like the
rest; the sync must not mark them Sensitive.

## One-time setup (about 30 minutes)

1. **Account and project.** Sign up at [infisical.com](https://infisical.com) (Infisical Cloud; check that the free plan
   covers one project with three environments). Turn on MFA. Create the project `receipt-ocr` with environments `dev`,
   `staging`, `prod`, and the folder `/ops` in `dev`.
2. **Import the local files** in the dashboard: open the environment, then drag the `.env` file onto the secrets
   table. Do `prod` from `~/.receipt-ocr-prod.env`, `staging` from `~/.receipt-ocr-staging.env`, and `dev` from the
   repo's `.env` (then move the operator tokens into `/ops`).
   - Both home files have five lines whose key was cut to `S`. Find out what they are (most likely the storage keys,
     `S3_*`) and fix the names before or right after import.
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

## Rotating a key

Change it in the service, paste the new value into Infisical, let the sync push it, redeploy
([step 7](production-environment.md#7-deploy-and-check)), then revoke the old one in the service. The 2026-11-08
Resend change followed this order.

## CI

GitHub Actions keeps its own repository secrets for now. Moving them to Infisical (a machine identity with universal
auth, read-only on `prod`) is optional and only worth it once more than one place needs the same value.
