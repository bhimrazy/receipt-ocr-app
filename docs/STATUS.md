# Status and handoff

Where the project stands, what is in flight, and what needs a decision. Read this first when picking the work up on a
new machine; keep it current when something merges or a decision is made. Last updated 2026-11-06 (after #36).

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
| #32           | Better Auth mitigations: exact workspace roles (GHSA-c85h), cookie cache off (revoked sessions stop at once), manual deploy runs only from `main`                                                                      |
| #34           | [Architecture guide](architecture/README.md) with per-package pages, flows and diagrams                                                                                                                                |
| #35           | Optional Cloudflare Turnstile on sign-up, sign-in, password reset, resend verification and the support form, with hostname pinning                                                                                     |
| #36           | UX sweep: honest landing copy, no sideways scroll at 390 px, quota wording that matches the ledger                                                                                                                     |
| #37           | Postgres job queue: `jobs` table, leases, retries with backoff, per-user fairness, provider cooldowns; uploads and retries run through it in `after()` ([flow](architecture/flows/jobs.md)); migration `0008`          |
| #38           | Hardening: session check before the upload body, PDF page cap, per-email auth limits, CSP reports, health endpoints, SECURITY.md, [runbook](runbook.md)                                                                |
| #40           | Load test suite on a 1 vCPU / 1 GB server (`scripts/load.sh`, manual `load.yml`); [results](../bench/results/load-2026-11-06.md)                                                                                       |

## Migrations squashed (2026-11-07)

Pre-launch, all migrations `0000`-`0010` were squashed into one `0000_baseline` that also enables row-level security on
every table (no policies; the app role bypasses it, so it is defence in depth for Supabase's Data API). Both databases
are empty and get reset. **From the first real user onward we never squash again.** Details:
[data layer](architecture/db.md#migrations).

## Production to-dos (owner)

Steps are in [deployment.md](deployment.md).

- Reset `staging-db` and `production-db` (the explicit SQL in [deployment.md](deployment.md#release-notes), not `DROP SCHEMA public`), run **Database Migration** on
  `staging-db`, then `production-db` (owner approves), then deploy by hand. This applies the squashed baseline with
  row-level security. Then check the **RLS enabled** badge in the Supabase dashboard and remove `public` from the
  Data API's exposed schemas ([deployment.md](deployment.md#release-notes)).
- Production deploys automatically after CI passes on a push to `main`. Manual runs are allowed only from `main`.
  Once `ci/db-migrations` lands, the automatic deploy skips any release that changes `apps/web/drizzle/` since the
  last successful production deploy run; migrations run only by hand (**Database Migration**: `staging-db`, then `production-db`
  with the owner's approval), then the deploy is run by hand. Production and staging are reset to the squashed baseline.
- `staging-db` and `production-db` exist (`main` only, `DIRECT_URL` set, required reviewer on `production-db`).
  Still to do for `ci/db-migrations`: point Vercel's Preview variables at `receipt-ocr-staging`, leave
  `BETTER_AUTH_URL` unset there and turn on Deployment Protection for previews
  ([deployment.md](deployment.md#staging-and-previews)). After merging, once: run **Database Migration** for
  `staging-db`, then `production-db` (applies the baseline), then **Vercel Production Deployment** by hand. Manual
  deploys need a successful `production-db` run with the same migrations. The automatic gate compares with the last
  run of the workflow on `main` whose `deploy-production` job succeeded; CI creates no git tags (tags are for real
  releases, later).
- `feat/anthropic-provider` adds migration `0001_ocr_call_refused_unsupported` (widens `ocr_calls_status_check`
  with `refused` and `unsupported-file`; existing rows stay valid). Run **Database Migration** before deploying it:
  without it, a refused or skipped call fails its ledger insert.
- `vercel` environment (review P2-1): previews and production share it, so the same `VERCEL_TOKEN`, which can deploy
  to production, reaches same-repo PR runs; it can't get a `main`-only policy without breaking previews. Mitigations:
  every production secret is stored as Vercel Sensitive (`vercel pull` can't read them back), and the repository has
  no outside collaborators. The full fix is a separate Vercel project for previews, with its own token.
- Keep every new production secret Sensitive in Vercel. The build tolerates their placeholders (fix in
  `ci/db-migrations`); `BETTER_AUTH_SECRETS` was removed from Vercel as a stopgap and can go back once it lands.
- Set `OCR_DAILY_CAP` in production as a spend guard.
- Vercel env: `NEXT_PUBLIC_SITE_URL`, `SUPPORT_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`; recommended
  `BETTER_AUTH_SECRETS=1:<current BETTER_AUTH_SECRET>`.
- The production Gemini key must belong to a paid Google project (free-tier content can be used by Google).
- If an admin saved an OCR chain naming `gemini-3.7-flash`, re-save it in Admin → Settings.

## In flight

| Track (branch)                 | Work                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/capture`                 | In-app camera, batch capture (limit per plan, default 10, set in Admin), four-corner crop with auto edge detection and straightening                                                                                                |
| `feat/size-target-encoder`     | Browser shrinking by pixel budget with a size target (about 500 KB, at most about 1 MB); tall receipts keep readable width                                                                                                          |
| `feat/pwa`                     | Installable app: PNG icons, offline page, service worker (no receipt or API caching), Android share target, install prompt                                                                                                          |
| `feat/mobile-shell`            | App-like mobile shell: bottom tab bar with Scan, compact top bar, sheets; desktop sidebar review                                                                                                                                    |
| `fix/pdf-page-evasions`        | Five remaining ways to hide pages from the PDF page counter                                                                                                                                                                         |
| `feat/admin-ops`               | Admin Operations page (volume, latency, cost, failures, queue charts), `/admin/jobs` with audited re-run, cancel and pause/resume; index only                                                                                       |
| `feat/receipt-groups`          | Receipt groups: named collections per workspace, History filter and selection, picker, `/app/groups`, CSV `groups` column; apply its migration before deploying                                                                     |
| `feat/dashboard`               | Home spending dashboard per currency: this month vs last, 12 months, categories, merchants, tax, previous-period comparison                                                                                                         |
| `ci/db-migrations`             | Manual **Database Migration** workflow, automatic deploy skipped when migrations changed, build-time secrets fix, preview sign-in on the preview's own host against staging                                                         |
| `feat/consent-analytics`       | Cookie consent and analytics on public pages only: Vercel Web Analytics (cookie-free), optional GA4 after opt-in, `/cookies` (#53)                                                                                                  |
| `feat/wide-events` (#52)       | [Wide events](architecture/flows/observability.md): one event per request, page render, job attempt and tick; schema allowlist, tail sampling (`LOG_SAMPLE_RATE`, `LOG_SLOW_MS`); `job.run` is now `job.attempt`. Next: OTLP export |
| `feat/admin-check-connections` | Admin → Settings → Connections: on-demand status check of AI providers (free model-list call), storage (put/get/delete) and a test email to yourself; warns after saving the OCR chain; audited, rate-limited                       |
| `feat/anthropic-provider`      | Anthropic as a second OCR provider: Claude Haiku 5.5, Sonnet 5.5, Opus 5.5 selectable in Admin → Settings; Gemini stays the default. Benchmark not run yet                                                                          |

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
5. Anthropic (direct key, `ANTHROPIC_API_KEY`): approve the Claude benchmark spend (dry-run estimate about $0.34 for
   the six fixtures on all three models), then which Claude model, if any, joins the production chain and where.
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

## Roadmap (order)

From the [combined plan](plans/2026-11-06-combined-plan.md):

1. ~~Usage capture + quota ledger~~ (shipped in #27).
2. Usage surfaces for customers and admins ([usage design](plans/2026-11-06-usage-design.md)).
3. Observability: wide events (#52), then OTLP export to Axiom, then the optional Sentry and server PostHog extras
   ([observability](plans/2026-11-06-observability.md)) with the [security requirements](reviews/2026-11-06-security-plan.md).
4. Accuracy: arithmetic checks, low thinking, a real benchmark set, then Flash-Lite-first cascade
   ([extraction cost and accuracy](plans/2026-11-06-extraction-cost-accuracy.md)). No Docling/OCR-first pipeline.
   Benchmark set and engines to compare (Qwen3-VL-8B via an OpenAI-compatible host, LlamaExtract, Mistral OCR):
   [parsers landscape](plans/2026-11-06-parsers-landscape.md). LangChain, Reducto, Unstructured and OCR-to-markdown
   models: no.
   Real benchmark set (CORD/CORU committed, SROIE/ReceiptBench local, the owner's 40 Nepal receipts, BS-date and
   Devanagari scoring fixes): [receipt benchmark set](plans/2026-11-07-receipt-benchmark-set.md). Long receipts as
   multi-part receipts: [long receipt capture](plans/2026-11-07-long-receipt-capture.md).
5. Second provider: Anthropic wired in (`feat/anthropic-provider`); admitted to the default chain only by the
   benchmark. Then OpenAI.
6. Passkeys and two-factor ([plan](plans/2026-11-06-passkeys-2fa.md)): PR A TOTP + backup codes + Settings →
   Security; PR B passkeys (primary sign-in) + admin enforcement. Each adds a migration after the baseline.
7. Members, seats and per-workspace quota; monthly limits and billing after decisions.
8. Load test: `scripts/load.sh` (by hand, and from `.github/workflows/load.yml` on demand) runs the production image on
   1 vCPU / 1 GB against k6; [`bench/README.md`](../bench/README.md#load-test-small-server). Re-run it after changes
   to the hot path and commit the new summary. Latest: reads hold 200/s; uploads hold 12/s and fail by 48/s since the job queue (ladder not yet filled in).
9. Product: landing claims, free no-signup tool, duplicate detection, per-currency totals, accounting exports.
   Currency honesty (no USD default, 3-decimal amounts) and conversion to a home currency:
   [currencies and FX](plans/2026-11-06-currencies-fx.md).
10. Read-only agent access over MCP: personal tokens first, then OAuth for Claude.ai and ChatGPT ([MCP server](plans/2026-11-07-mcp-server.md)).
11. Bring your own AI key (Pro perk, maybe a capped Free on-ramp), then own storage (R2 first), on envelope
    encryption with rotation ([BYOK plan](plans/2026-11-07-byok.md)). After billing.

## Later, once the app is stable (owner notes, 2026-11-07)

- **Release-based deploys.** Today every push to `main` deploys after CI (migrations by hand). Move to deploying
  tagged releases (for example `v0.x.y` with release notes), so `main` can take merges without each one going live.
- **Self-hosting.** Vercel's free (Hobby) plan is for non-commercial use and has hard monthly limits; a busy month or
  paying users outgrow it. The exit is already built: the Docker image (`docker/Dockerfile.prod`, Bun runtime), the
  compose stack and the 1 vCPU / 1 GB load test. Decide between Vercel Pro and a small VPS (plus managed Postgres and
  R2, which stay as they are) when traffic or billing makes it necessary.

## Known follow-ups

- Encryption key rotation: re-encrypt job + per-version counts + split from the auth secret (see
  [BYOK plan](plans/2026-11-07-byok.md#9-key-rotation-and-encryption-at-rest)).
- FAQ uses a raw `<details>`; add a server-friendly Disclosure primitive to `packages/ui`.
- PDF page cap gaps: the hand-written page counter (`packages/core/src/pdf-pages.ts`) can undercount when the word
  `stream` sits inside a string or `/stream` is used as a name, when `endobj` sits inside a string, when comments sit
  inside a dictionary, and for encrypted object streams. The list is not exhaustive. The cap is a
  cost guard, not a security boundary: uploads are size-capped, the daily quota bounds total cost and the ledger
  records real tokens per call, so an outlier is visible. If abuse shows up, count with a real reader (pdf.js in a
  worker with a timeout) rather than parsing further by hand.
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
- Benchmark has six synthetic images and no committed results.
- Load test findings (after #37): upload capacity on the small server fell from 64/s to between 12/s (holds) and
  48/s (fails: end-to-end p95 17 s, Postgres CPU 87%). The quota count (`ocr_rounds` per user, per page and twice per
  upload) is still the top Postgres statement, with the job queue queries next. Next: a performance track that fills
  in the 24/36/48 ladder after #38, profiles both, replaces the quota count with something cheaper, and runs a
  30-minute soak. The app also holds up to 10 connections against a pool max of 5. Pages emit `page.render` events
  from #52 on.

- Perf/SEO follow-ups from [the audit](reviews/2026-11-06-perf-seo.md) on files other tracks own: root layout
  preloads DM Sans with the `opsz` axis (62 KB) and JetBrains Mono (40 KB) on every page, and its `openGraph.url: "/"`
  and 179-char description reach pages without their own metadata (PWA track); receipt page `<img>` has no
  width/height and its `dl` wraps `dt`/`dd` in extra divs, and the history search box is the LCP element after
  hydration (mobile shell track).

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
