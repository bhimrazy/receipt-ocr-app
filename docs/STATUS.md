# Status and handoff

Where the project stands, what is in flight, and what needs a decision. Read this first when picking the work up on a
new machine; keep it current when something merges or a decision is made. Last updated 2026-11-06 (after #44).

How the system is built (every app and package, the main flows and the data model) is in
[architecture](architecture/README.md).

## Shipped to `main` (2026-11-06)

| PR            | What                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #13           | Classic landing lab (`/final-classic`, noindex), SEO plumbing (site URL, robots, sitemap), Vercel `--archive=tgz` deploys                                                                                              |
| #17           | Redesigned sign-in, sign-up, verification, reset and invite flows                                                                                                                                                      |
| #18           | Signed-in app redesign; preview/mock-data flow removed; no-workspace state                                                                                                                                             |
| #19           | Security hardening: email escaping, workspace-name rules, trusted IP headers, hashed tokens, encrypted OAuth tokens, versioned secrets, receipt write policy                                                           |
| #20           | UI foundations: design tokens, Alert/Field, history and members split                                                                                                                                                  |
| #21           | Admin panel: overview, users, workspaces, audit log, settings (plan limits, OCR model chain); migration `0006`                                                                                                         |
| #22           | Receipt completion guarded by attempt; OCR loads receipts by id                                                                                                                                                        |
| #23           | [Deployment guide](deployment.md)                                                                                                                                                                                      |
| #24           | Default model `gemini-3.8-flash`, `gemini-3.5-flash-lite` offered (`gemini-3.7-flash` doesn't exist)                                                                                                                   |
| #25           | Photos shrunk and re-encoded in the browser (fixes Vercel 4.5 MB 413s, strips camera metadata); PDFs accepted                                                                                                          |
| #26, #28      | Handoff docs: this page, plans and reviews; parser/benchmark/open-model survey                                                                                                                                         |
| #27           | OCR usage ledger: `ocr_rounds` + `ocr_calls` with per-call tokens, cost and latency; quota counted from the ledger under a per-user lock (deletes no longer refund; first 5 failed reads a day free); migration `0007` |
| #29, #30, #33 | Status updates, working principles, Next.js/React/shadcn reviews, job queue plan, security audit                                                                                                                       |
| #31           | Streaming app pages, fewer client auth fetches, polling paused while hidden, lab pages hidden in production, skip link, global error page                                                                              |
| #32           | Better Auth mitigations: exact workspace roles (GHSA-c85h), cookie cache off (revoked sessions stop at once), manual deploys only from `main`                                                                          |
| #34           | [Architecture guide](architecture/README.md) with per-package pages, flows and diagrams                                                                                                                                |
| #35           | Optional Cloudflare Turnstile on sign-up, sign-in, password reset, resend verification and the support form, with hostname pinning                                                                                     |
| #36           | UX sweep: honest landing copy, no sideways scroll at 390 px, quota wording that matches the ledger                                                                                                                     |
| #37           | Postgres job queue: `jobs` table, leases, retries with backoff, per-user fairness, provider cooldowns; uploads and retries run through it in `after()` ([flow](architecture/flows/jobs.md)); migration `0008`          |
| #38           | Hardening: session check before the upload body, PDF page cap, per-email auth limits, CSP reports, health endpoints, SECURITY.md, [runbook](runbook.md)                                                                |
| #40           | Load test suite on a 1 vCPU / 1 GB server (`scripts/load.sh`, manual `load.yml`); [results](../bench/results/load-2026-11-06.md)                                                                                       |
| #42           | Browser image shrinking by pixel budget (3 MP, short edge 1000 px or more) to about 500 KB, at most 1 MB; every decodable image re-encoded so metadata never reaches the server                                        |
| #44           | [Currencies and FX plan](plans/2026-11-06-currencies-fx.md): `numeric(19,4)`, per-workspace home currency, Frankfurter rates on the receipt date, seven PRs                                                            |

## Production to-dos (owner)

Steps are in [deployment.md](deployment.md).

- Run `bun run db:migrate` against production for `0006_admin_audit_settings` (admin panel) and
  `0007_ocr_usage_ledger` (usage ledger), then `0008_jobs_queue` (job queue) before deploying #37 or later. After `0007`,
  everyone's "used today" restarts once (the ledger starts empty).
- Set `OCR_DAILY_CAP` in production as a spend guard.
- Vercel env: `NEXT_PUBLIC_SITE_URL`, `SUPPORT_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`; recommended
  `BETTER_AUTH_SECRETS=1:<current BETTER_AUTH_SECRET>`.
- The production Gemini key must belong to a paid Google project (free-tier content can be used by Google).
- If an admin saved an OCR chain naming `gemini-3.7-flash`, re-save it in Admin → Settings.

## In flight

Each track has its own branch (and worktree on the original machine). Open the PR to see done, left and next steps.

| PR or branch                       | Work                                                                                                                                                             | State                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| #41 `fix/pdf-page-evasions`        | Five more PDF page-hiding cases                                                                                                                                  | Fix round: /Kids overcounted Chrome and macOS PDFs (10 pages counted 12); then re-review                                |
| #43 `feat/pwa`                     | Installable app: icons, offline page, service worker, Android share target, install prompt                                                                       | Review approved; fix round for cross-site share injection, empty MIME type, sign-out cleanup, kill switch               |
| #45 `fix/three-decimal-currencies` | Prompt: KWD/BHD/OMR three digits are fils, not thousands                                                                                                         | Review approved; small follow-up (drop IQD); real-model benchmark still to run (local key invalid)                      |
| #46 `feat/mobile-shell`            | Phone tab bar with Scan, top bar with Back, account and receipt-action sheets, `Drawer`                                                                          | Product and code review running                                                                                         |
| #47 `feat/capture`                 | In-app camera, batch tray (`batchMax` per plan, default 10, in Admin), four-corner crop with auto detection and straightening, filters (Enhance, Greyscale, B&W) | Ready for review; `/app/upload` reads `?capture=1` and `?shared=1`; full e2e needs a clean run on a quiet machine or CI |
| #48 `feat/receipt-groups`          | Groups (many per receipt), filter, bulk add, CSV column, `/app/groups`; migration `0009`                                                                         | Building                                                                                                                |
| #49 `feat/dashboard`               | Home dashboard: this month vs last, 12 months, categories, merchants, tax; per currency                                                                          | Draft; e2e, docs and gates left; owns the shared `core/src/analytics/time-buckets.ts`                                   |
| `feat/admin-ops`                   | Admin Operations charts (volume, latency, cost, failures, queue) and `/admin/jobs` actions                                                                       | Building; copies the time-buckets helper and adds an hour unit                                                          |
| `feat/wide-events`                 | One wide event per request, page render and job attempt; sampling; redaction; OTLP plan                                                                          | Building                                                                                                                |
| `feat/consent-analytics`           | Cookie banner (equal Accept/Reject), `/cookies`, cookie-free analytics, optional GA4                                                                             | Building                                                                                                                |
| `fix/perf-seo`                     | Lighthouse and SEO audit of public pages, fixes, report in `docs/reviews/`                                                                                       | Building                                                                                                                |

Merge order that avoids most conflicts: #41, #45, #43, #46, then `feat/capture` (it resolves the upload-panel
conflict with #43), then groups (migration `0009`), dashboard, admin-ops (dedupe the time-buckets helper), wide
events, consent, perf/SEO. Every PR gets an independent review before merge.

Reviews from this round: [readiness audit](reviews/2026-11-06-readiness.md) (four lenses, ranked roadmap),
[Midday study](reviews/2026-11-06-midday-study.md), [UX sweep](reviews/2026-11-06-ux-sweep.md).

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
10. Usage ledger: retention period (suggested 13 months, then a purge job and a privacy-page line); whether the
    global cap needs a platform-wide lock (it can overshoot by the number of users uploading at the same moment).
11. Passkeys and two-factor ([plan](plans/2026-11-06-passkeys-2fa.md)): passkey rpID (host or apex via
    `PASSKEY_RP_ID`), require passkey or password+TOTP for platform admins, `session.freshAge` 24 h → 1 h, no email
    OTP, trusted-device length, nudges.
12. Currencies and conversion ([plan](plans/2026-11-06-currencies-fx.md)): home currency per workspace,
    `numeric(19,4)` amounts, Frankfurter as the only v1 rate source (self-host as the exit), backfill depth,
    which amounts are converted, sign-up default from country.

13. Mobile shell (#46): admin moved into the account sheet on phones (two taps); History badge for receipts that
    need attention (one extra count query per page); Home becomes a dashboard once Scan opens the camera; a light
    theme or stay dark-only.
14. Analytics on public pages: cookie-free by default (decided), GA4 only if you set its ID (it then needs the
    consent banner). Observability: OpenTelemetry (OTLP) export, Axiom as the default endpoint (decided).

## Roadmap (order)

From the [combined plan](plans/2026-11-06-combined-plan.md):

1. ~~Usage capture + quota ledger~~ (shipped in #27).
2. Usage surfaces for customers and admins ([usage design](plans/2026-11-06-usage-design.md)).
3. Observability: telemetry interface + Axiom + server PostHog, then Sentry, then optional browser PostHog
   ([observability](plans/2026-11-06-observability.md)) with the [security requirements](reviews/2026-11-06-security-plan.md).
4. Accuracy: arithmetic checks, low thinking, a real benchmark set, then Flash-Lite-first cascade
   ([extraction cost and accuracy](plans/2026-11-06-extraction-cost-accuracy.md)). No Docling/OCR-first pipeline.
   Benchmark set and engines to compare (Qwen3-VL-8B via an OpenAI-compatible host, LlamaExtract, Mistral OCR):
   [parsers landscape](plans/2026-11-06-parsers-landscape.md). LangChain, Reducto, Unstructured and OCR-to-markdown
   models: no.
5. Second provider (Anthropic), then OpenAI, each admitted by the benchmark.
6. Passkeys and two-factor ([plan](plans/2026-11-06-passkeys-2fa.md)): PR A TOTP + backup codes + Settings →
   Security; PR B passkeys (primary sign-in) + admin enforcement. Migrations take the next free numbers after `0008` (job queue).
7. Members, seats and per-workspace quota; monthly limits and billing after decisions.
8. Load test: `scripts/load.sh` (by hand, and from `.github/workflows/load.yml` on demand) runs the production image on
   1 vCPU / 1 GB against k6; [`bench/README.md`](../bench/README.md#load-test-small-server). Re-run it after changes
   to the hot path and commit the new summary. Latest: reads hold 200/s; uploads hold 12/s and fail by 48/s since the job queue (ladder not yet filled in).
9. Product: landing claims, free no-signup tool, duplicate detection, per-currency totals, accounting exports.
   Currency honesty (no USD default, 3-decimal amounts) and conversion to a home currency:
   [currencies and FX](plans/2026-11-06-currencies-fx.md).

## Known follow-ups

- Upload capacity on the small server fell after #37 (64/s to between 12 and 48/s). Performance track: profile the
  quota count and jobs queries, replace the quota count with a counter, fill in the 24/36/48 ladder, 30-minute soak.
- Real-model OCR benchmark in CI: a manual workflow using a repo secret for the Gemini key (with a spend cap), so
  prompt changes such as #45 are measured without a local key.
- Follow the glass-analytics study ideas already passed to the dashboard and admin tracks (URL date range with
  compare, previous-period lines, top 10 plus Other, indexes before rollups, usage and cost projection).

- Image shrinking (browser, `apps/web/lib/upload-prep.ts`): decode large photos at reduced size
  (`createImageBitmap` `resizeWidth`/`resizeHeight`, after reading the dimensions from the header) to cut peak memory
  on phones; and strip metadata on the server for files the browser couldn't decode or encode (for example HEIC
  outside Safari, or a canvas memory error), which still upload with their EXIF.
- Zod at every boundary: `PATCH /api/receipts/[id]` validates by hand and drops bad values; history/export query
  params, `apps/web/lib/env.ts` and customer forms should share Zod schemas (today Zod covers only the AI output
  schema, admin settings and admin actions).
- Bot protection: shipped, optional by env (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`). Turnstile guards
  sign-up, sign-in, password reset, resend confirmation (Better Auth `captcha` plugin) and `/api/contact`.
  `scripts/test.sh --turnstile` runs its e2e with Cloudflare test keys; CI does not run that phase yet.
- Best-practice reviews ([Next.js](reviews/2026-11-06-nextjs.md), [React](reviews/2026-11-06-react.md),
  [shadcn/UI](reviews/2026-11-06-shadcn-ui.md)): quick wins in progress; later, shared primitives (Spinner, Meter,
  Checkbox, Avatar, Empty, Pagination), Button aligned with base-nova, one form system on `Field`.
- Admin Settings shows "Last saved by…" for a saved OCR chain that was discarded as invalid.
- HEIC conversion untested (no fixture or Safari in CI); add a WebKit e2e project later.
- Lab marketing copy (`components/marketing/**`) still says PDFs aren't supported; goes away with the lab.
- Better Auth: verify the OAuth callback turns a banned user into `?error=BANNED_USER`.
- Delete `apps/web/lib/receipt-permissions.ts` in favour of one permission map in core.
- Benchmark has five synthetic images and no committed results.
- Load test findings (after #37): upload capacity on the small server fell from 64/s to between 12/s (holds) and
  48/s (fails: end-to-end p95 17 s, Postgres CPU 87%). The quota count (`ocr_rounds` per user, per page and twice per
  upload) is still the top Postgres statement, with the job queue queries next. Next: a performance track that fills
  in the 24/36/48 ladder after #38, profiles both, replaces the quota count with something cheaper, and runs a
  30-minute soak. The app also holds up to 10 connections against a pool max of 5, and pages emit no wide events.

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
