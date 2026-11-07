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
| #32           | Better Auth mitigations: exact workspace roles (GHSA-c85h), cookie cache off (revoked sessions stop at once), manual deploys only from `main`                                                                          |
| #34           | [Architecture guide](architecture/README.md) with per-package pages, flows and diagrams                                                                                                                                |
| #35           | Optional Cloudflare Turnstile on sign-up, sign-in, password reset, resend verification and the support form, with hostname pinning                                                                                     |
| #36           | UX sweep: honest landing copy, no sideways scroll at 390 px, quota wording that matches the ledger                                                                                                                     |
| #37           | Postgres job queue: `jobs` table, leases, retries with backoff, per-user fairness, provider cooldowns; uploads and retries run through it in `after()` ([flow](architecture/flows/jobs.md)); migration `0008`          |
| #38           | Hardening: session check before the upload body, PDF page cap, per-email auth limits, CSP reports, health endpoints, SECURITY.md, [runbook](runbook.md)                                                                |
| #40           | Load test suite on a 1 vCPU / 1 GB server (`scripts/load.sh`, manual `load.yml`); [results](../bench/results/load-2026-11-06.md)                                                                                       |

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

| Track (branch)             | Work                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/capture`             | In-app camera, batch capture (limit per plan, default 10, set in Admin), four-corner crop with auto edge detection and straightening                                 |
| `feat/size-target-encoder` | Browser shrinking by pixel budget with a size target (about 500 KB, at most about 1 MB); tall receipts keep readable width                                           |
| `feat/pwa`                 | Installable app: PNG icons, offline page, service worker (no receipt or API caching), Android share target, install prompt                                           |
| `feat/mobile-shell`        | App-like mobile shell: bottom tab bar with Scan, compact top bar, sheets; desktop sidebar review                                                                     |
| `fix/pdf-page-evasions`    | Five remaining ways to hide pages from the PDF page counter                                                                                                          |
| `feat/admin-ops`           | Admin Operations page (volume, latency, cost, failures, queue charts), `/admin/jobs` with audited re-run, cancel and pause/resume; migration `0010` (index only)     |
| `feat/receipt-groups`      | Receipt groups: named collections per workspace, History filter and selection, picker, `/app/groups`, CSV `groups` column; migration `0009` (apply before deploying) |

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
  30-minute soak. The app also holds up to 10 connections against a pool max of 5, and pages emit no wide events.

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
