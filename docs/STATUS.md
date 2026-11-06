# Status and handoff

Where the project stands, what is in flight, and what needs a decision. Read this first when picking the work up on a
new machine; keep it current when something merges or a decision is made. Last updated 2026-11-06.

## Shipped to `main` (2026-11-06)

| PR  | What                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #13 | Classic landing lab (`/final-classic`, noindex), SEO plumbing (site URL, robots, sitemap), Vercel `--archive=tgz` deploys                                    |
| #17 | Redesigned sign-in, sign-up, verification, reset and invite flows                                                                                            |
| #18 | Signed-in app redesign; preview/mock-data flow removed; no-workspace state                                                                                   |
| #19 | Security hardening: email escaping, workspace-name rules, trusted IP headers, hashed tokens, encrypted OAuth tokens, versioned secrets, receipt write policy |
| #20 | UI foundations: design tokens, Alert/Field, history and members split                                                                                        |
| #21 | Admin panel: overview, users, workspaces, audit log, settings (plan limits, OCR model chain); migration `0006`                                               |
| #22 | Receipt completion guarded by attempt; OCR loads receipts by id                                                                                              |
| #23 | [Deployment guide](deployment.md)                                                                                                                            |
| #24 | Default model `gemini-3.8-flash`, `gemini-3.5-flash-lite` offered (`gemini-3.7-flash` doesn't exist)                                                         |
| #25 | Photos shrunk and re-encoded in the browser (fixes Vercel 4.5 MB 413s, strips camera metadata); PDFs accepted                                                |

## Production to-dos (owner)

Steps are in [deployment.md](deployment.md).

- Run `bun run db:migrate` against production for `0006_admin_audit_settings` (admin panel needs it).
- Vercel env: `NEXT_PUBLIC_SITE_URL`, `SUPPORT_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`; recommended
  `BETTER_AUTH_SECRETS=1:<current BETTER_AUTH_SECRET>`.
- The production Gemini key must belong to a paid Google project (free-tier content can be used by Google).
- If an admin saved an OCR chain naming `gemini-3.7-flash`, re-save it in Admin → Settings.

## In flight

| Work                                    | Where                      | Notes                                                                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Track 1: usage capture + quota ledger   | branch `feat/ocr-usage`    | `ocr_calls` table, token/cost per model call, quota counted from the ledger at claim time with a per-user lock (closes delete-to-reset). Plan: [combined-plan](plans/2026-11-06-combined-plan.md), [ai-usage-models](plans/2026-11-06-ai-usage-models.md) |
| Parser, benchmark and open-model survey | will land in `docs/plans/` | LlamaParse/LlamaExtract, ParseBench and other benchmarks, receipt datasets (CORD, SROIE…), small open-weight models                                                                                                                                       |

## Decisions waiting on the owner

1. **Better Auth security upgrade.** 1.7.14 is affected by advisories fixed in 1.7.16 (OAuth unverified email,
   padded owner role, revoked sessions with cookie cache). 1.7.16 is inside the 7-day cooldown until 2026-11-10;
   upgrading earlier needs a one-time exemption for `better-auth`, `@better-auth/*`, `better-call`.
2. Classic as the homepage (then delete `app/(lab)` and `components/marketing`, ~41% of TS code).
3. Plan limits: daily per user (today) or monthly per workspace; prices; payment provider. See
   [CEO](reviews/2026-11-06-ceo.md) and [market](reviews/2026-11-06-market.md) reviews.
4. Who sees estimated cost (recommended: platform admins only); whether customers see the model name; whether
   members see each other's usage; admin access to receipt photos (recommended: hidden, logged "Show photo").
5. Second AI provider (recommended: Anthropic Haiku), direct keys vs Vercel AI Gateway.
6. PostHog: server-only first (recommended) or browser too; Sentry tracing off; source-map upload approach.
7. Members: free seats 3 or 5, single owner + transfer, pending invites count. See
   [members plan](plans/2026-11-06-members-admin-plan.md).
8. Branch protection on `main` requiring CI.
9. BYOK tables (`user_credentials`, `storage_source`): keep or delete.
10. Passkeys and two-factor ([plan](plans/2026-11-06-passkeys-2fa.md)): passkey rpID (host or apex via
    `PASSKEY_RP_ID`), require passkey or password+TOTP for platform admins, `session.freshAge` 24 h → 1 h, no email
    OTP, trusted-device length, nudges.

## Roadmap (order)

From the [combined plan](plans/2026-11-06-combined-plan.md):

1. Usage capture + quota ledger (in flight).
2. Usage surfaces for customers and admins ([usage design](plans/2026-11-06-usage-design.md)).
3. Observability: telemetry interface + Axiom + server PostHog, then Sentry, then optional browser PostHog
   ([observability](plans/2026-11-06-observability.md)) with the [security requirements](reviews/2026-11-06-security-plan.md).
4. Accuracy: arithmetic checks, low thinking, a real benchmark set, then Flash-Lite-first cascade
   ([extraction cost and accuracy](plans/2026-11-06-extraction-cost-accuracy.md)). No Docling/OCR-first pipeline.
5. Second provider (Anthropic), then OpenAI, each admitted by the benchmark.
6. Passkeys and two-factor ([plan](plans/2026-11-06-passkeys-2fa.md)): PR A TOTP + backup codes + Settings →
   Security; PR B passkeys (primary sign-in) + admin enforcement. Migrations `0007`, `0008`.
7. Members, seats and per-workspace quota; monthly limits and billing after decisions.
8. Product: landing claims, free no-signup tool, duplicate detection, per-currency totals, accounting exports.

## Known follow-ups

- Admin Settings shows "Last saved by…" for a saved OCR chain that was discarded as invalid.
- HEIC conversion untested (no fixture or Safari in CI); add a WebKit e2e project later.
- Lab marketing copy (`components/marketing/**`) still says PDFs aren't supported; goes away with the lab.
- Better Auth: verify the OAuth callback turns a banned user into `?error=BANNED_USER`.
- Delete `apps/web/lib/receipt-permissions.ts` in favour of one permission map in core.
- Benchmark has five synthetic images and no committed results.

## How to resume on another machine

1. `git clone`, `bun install --frozen-lockfile`, then follow the [README](../README.md) local setup.
2. Tests the way CI runs them: `scripts/test.sh` (compose Postgres on 5433 + RustFS on 9000, fresh test database,
   unit + Playwright e2e). Integration suites: `bun run --filter @receipt-ocr/core test:int` and `--filter @receipt-ocr/web test:int` against a throwaway database.
3. Conventions:
   - One worktree per track next to the repo (`git worktree add ../receipt-ocr-<track> -b <branch> origin/main`);
     remove it after merge.
   - Squash-merge every PR. For stacked PRs, update each child with merge commits only (no rebase or force push):
     merge the parent branch, then `git merge -s ours <parent squash commit>` after checking the trees match, then
     `git merge origin/main`. GitHub stacks need the async merge endpoint (`PUT …/pulls/{n}/merge-async`).
   - Every PR gets an independent review before merge; fix P0/P1 first.
   - Dependencies: exact pins, ≥7 days old (`bunfig.toml` cooldown), `bun run check:deps`.
   - PR descriptions start with "What does this PR do?".
4. Plans live in `docs/plans/`, reviews in `docs/reviews/`, dated. Add new ones there rather than in local notes.
