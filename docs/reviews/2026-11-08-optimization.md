# Optimization audit, 2026-11-08

Read-only audit of `main` at 9f35a25. Nothing was built for this review. Client bundle numbers come from the existing
`next build` output in the `feat/sign-in-methods` worktree (b0069d2, which is 79151ba plus PR #132; #130 since then is
backend-only). CI numbers come from main CI run 42455450463 (79151ba) and the last 100 CI runs. Ranking is
(impact x confidence) / effort.

## Not verified

- No Lighthouse or WebPageTest run, and no field LCP/CLS data. LCP notes come from the 2026-11-06 perf review.
- No access to Vercel usage (invocations, GB-hours) or Supabase metrics. Cold start on Vercel was not measured.
- Next 16.4 no longer prints First Load JS in `next build`, so CI logs have no per-route sizes. The sizes below are
  root main files plus each page's `entryJSFiles` from `page_client-reference-manifest.js`, gzipped at level 9
  (script in the appendix). They roughly match the 2026-11-06 method.
- Local import timings ran on a codespace at load average 15 on 2 vCPU. They show relative cost only.

## Ranked findings

| #   | Finding                                                         | Gain (est.)                                      | Effort | Conf.  | Lives in                                                    | May conflict with                       |
| --- | --------------------------------------------------------------- | ------------------------------------------------ | ------ | ------ | ----------------------------------------------------------- | --------------------------------------- |
| 1   | Consent dialog, banner and PWA card load eagerly on every page  | -25 to 35 KB gz on every route                   | S      | High   | `components/consent/consent-manager.tsx`, `components/pwa.tsx` | #132 (touches `lib/consent/cookies.ts`) |
| 2   | Zod reaches the client through `group-rules`                    | -30 KB gz on history, groups, receipt detail     | S      | High   | `packages/core/src/group-rules.ts`                          | none found                              |
| 3   | A new presigned image URL on every render, no Cache-Control     | No re-download on revisits or `router.refresh()` | S      | High   | `packages/storage/src/index.ts:132`                         | none found                              |
| 4   | CI typechecks four times per job and runs e2e on 2 workers      | 30 to 60 s off the 4-minute critical path        | S      | Medium | `turbo.json`, `packages/*/package.json`, `ci.yml`, Playwright config | observability-otlp (turbo.json), test/wiring (package.json), #131 (ci.yml) |
| 5   | Timing-sensitive tests near their budgets                       | Fewer red reruns                                 | S      | High   | `auth.int.test.ts:213`, `e2e/upload.spec.ts:33`, `filters.test.ts:97` | test/wiring (`auth.int.test.ts`)        |
| 6   | Poll route reads the full receipt plus items; session takes 2 queries | 1 to 2 fewer queries and less payload per poll | S-M | Medium | `api/receipts/[id]/route.ts:44`, `repository.ts:582`, `lib/auth.ts` | #132 and billing-paddle (`lib/auth.ts`) |
| 7   | Every API route loads the S3 SDK, Resend, email templates and AI SDKs | Faster cold starts on light routes          | M      | Low    | `packages/storage/src/index.ts`, `packages/core/src/index.ts` barrel | billing-paddle, observability-otlp (core) |
| 8   | Instant upload PUTs the file, then the job GETs it back         | One R2 round trip per instant upload             | M      | Medium | `packages/core/src/pipeline.ts:181,283`                     | billing-paddle (`pipeline.test.ts`)     |
| 9   | DB pool: no `max_lifetime`; default 5 per instance on Vercel    | Pooler headroom and recycling                    | S      | Medium | `packages/db/src/index.ts:583-595`                          | billing-paddle (`packages/db/src/index.ts`) |
| 10  | Mono font preloaded on every page; recharts eager on admin ops  | -40 KB font preload; admin only                  | S      | Medium | `app/layout.tsx:18`, `components/admin/ops/charts.tsx`      | #132 (`app/app/layout.tsx`, not root)   |

### 1. Root layout client JS has grown by about 45 KB gz since 2026-11-06

Evidence (gz KB, 11-06 review → now): `/` 143 → 192, `/sign-in` 175 → 216, `/app` 245 → 291,
`/app/receipts/[id]` 256 → 331, `/privacy` 145 → 188. Shared root main files come to 129 KB gz. The root layout
(`app/layout.tsx`) adds six chunks, about 51 KB gz, to every route, `/privacy` included:
`10q3t12ith986` (10 KB: Vercel Analytics, gtag, consent, service worker, install prompt), plus five Base UI chunks
(`2mglkofb1s47j` 11 KB, `3z2bntfvho8aw` 9 KB, `2z4b_yrhrune8` 8 KB, `2rv62t94tgj6a` 7 KB Dialog/Backdrop/Popup,
`3hr93iombyc7j` 6 KB). `consent-manager.tsx` statically imports `CookieBanner` and `ConsentDialog` (Dialog,
Switch, Badge, Button), and `pwa.tsx` imports Button and Card. Most visits need none of them: the dialog opens only from
"Customise" or "Cookie settings", and the banner shows only until a choice is made.
Change: `next/dynamic` (or `React.lazy`) for `ConsentDialog` on open, and for `CookieBanner` when `needsBanner` is true.
Load the PWA install card only once `beforeinstallprompt` fires (or on iOS Safari). `e2e/consent-ga.spec.ts` and
`pwa.spec.ts` already cover the flows. Risk: the banner can appear late on a first visit, so keep its space
reserved or keep it fixed so there is no CLS.

### 2. Zod ships to three app routes

Chunk `2nwtbo2in7zb4` (30 KB gz, 383 `zod` references) is in `app/history`, `app/groups` and `app/receipts/[id]`
only. Client components import nothing but `GROUP_COLORS`, `MAX_GROUPS_PER_RECEIPT` and types from
`@receipt-ocr/core/group-rules`. That module builds zod schemas at the top level (`group-rules.ts:31-62`), so they
can't be tree-shaken. Change: move the schemas to a server-only `group-schemas.ts` and keep the constants and types
in `group-rules.ts`. Risk: none at runtime; the routes' unit tests cover the schemas.

### 3. Receipt images can't be cached

`signedGetUrl` (`storage/src/index.ts:132`) signs a fresh URL with `X-Amz-Date` set to now on every render.
`putObject` (`:62`) sets no `CacheControl`. Each visit to the detail page, and each `router.refresh()` after
`ProcessingPoller` sees a change, downloads the receipt again (prep targets 500 KB to 1 MB, `upload-prep.ts:19`).
The 11-06 review found the image is the LCP element on `/app/receipts/[id]`. Change: pass `signingDate` floored to a
5-minute bucket (keep `expiresIn` at 600 s or more, so a URL is always valid for at least 5 minutes), and add
`ResponseCacheControl: "private, max-age=300"`. Also set `width`/`height` on the `<img>`
(`receipt-result.tsx:204`), open since 11-06. Risk: low. URLs stay short-lived and private.

### 4. CI critical path: about 4 minutes, mostly e2e

Run 42455450463 jobs: static 32 s, checks 1 m 36 s, Turnstile e2e 2 m 0 s, **e2e 3 m 58 s**. Inside e2e: setup and
migrate about 25 s, integration tests in parallel with the build 51 s, Playwright **2.0 m for 93 tests on 2 workers**
(`Running 93 tests using 2 workers`), and the GA build plus consent spec 20 s. Busiest specs by summed test time:
capture 58 s, upload 32 s, admin 25 s.

- Type checking runs four times per job. `checks` runs `turbo typecheck` (20.5 s). `test` depends on `^build`
  (`turbo.json`). Each package's `build` script is `tsc --noEmit` again (`packages/*/package.json`). `next build`
  then runs TypeScript again (8.7 s in checks, 10.4 s in Turnstile). Turbo reports `Cached: 0 cached` and warns
  `no output files found` for all six package builds. Change: drop the package `build` scripts (Next transpiles them
  through `transpilePackages`). In the two e2e jobs, skip Next's type check (`typescript.ignoreBuildErrors` behind a
  CI-only env), because `checks` gates types. Expected 10 to 20 s per build across three jobs.
- Playwright: the runner has 4 vCPUs (Next uses "3 workers"), and Playwright defaults to half. Try `workers: 3` and
  measure. If capture specs flake, shard instead: 2 shards in parallel each need their own build (about 40 s cached).
  Expected 30 to 60 s.
- `upload.spec.ts:39-56` moves a 5 MB JPEG out of the browser as `Array.from(Uint8Array)`, millions of JSON numbers
  over CDP. The test takes 27.0 s against a 60 s timeout. Return base64 instead, or generate the fixture once in
  Node.
- Already good: actions pinned by SHA, the bun cache hits (install 1.2 s), the Next cache per scope (the GA rebuild
  compiled in 718 ms), and docs-only PRs skip the jobs.

### 5. Flaky timing tests (history: 7 failures in the last 100 CI runs)

- Failures seen: jobs.int (two runs on main, 11-07, fixed in #109), upload/pdf-pages e2e click timeouts (fixed in
  #116), the capture filter preview (#99), an SEO description failure and a real auth.int 403 on a branch.
- `auth.int` "M3: locks sign-in…" took **3,123 ms against Vitest's 5 s default** while `next build` ran alongside. It
  does about 40 password hashes. "M3: caps password-change attempts" took 2,444 ms. Change: set a per-test timeout
  (`it(..., 20_000)`) on the hash-heavy cases.
- `filters.test.ts:97` asserts wall time under 1,500 ms (436 ms in CI). `detect-quad.test.ts:196` asserts under
  500 ms (file 546 ms). Absolute wall-clock bounds fail on a busy runner. Use the relative-baseline pattern from
  `pdf-pages.test.ts:424-442`. `files.test.ts` "too complex PDF" took 465 ms, so it is fine for now.

### 6. Requests per poll and per page

`GET /api/receipts/[id]` makes Better Auth `getSession` with the cookie cache off (`session.ts:24`, `auth.ts:327`).
Without `experimental.joins` (not set in `auth.ts`) that is a session lookup then a user lookup. `resolveScope` adds
one query, and `repo.get` loads every column plus `items` (`repository.ts:582-587`) to return 6 fields. A due-job
check follows while processing. Change: a `repo.status(id, scope)` select of only the returned columns, and try
Better Auth `experimental: { joins: true }` (check that 1.7.18 supports it with the Drizzle adapter, and its tests).
This saves 1 to 2 round trips on every authenticated request. Polling itself is well bounded: 2 s x3, 4 s x3, 8 s x3,
then 15 s, it pauses in hidden tabs and stops after 6 minutes (`backoff-poll.ts`). Lists poll the light counts
endpoint.

### 7. Cold start: light routes load the whole backend

Traces from the build: `/api/receipts/status` (one counts query) pulls 25 app chunks of 3.0 MB, the same as the upload
route (3.1 MB). That includes a 1.4 MB chunk with Resend and SigV4, 393 KB of email templates and the Better Auth
server, plus 270 `node_modules` files including the whole `@aws-sdk/client-s3` credential chain.
`/api/health` and `/api/jobs/drain` are 1.6 MB. The cause is the `@receipt-ocr/core` barrel and
`makeAppLayer` (`lib/runtime.ts`). Local import cost on the loaded box, warm runs: S3 SDK plus presigner 560 to 680 ms,
`ai` plus four providers 300 to 340 ms. Change: `await import()` the S3 client inside `s3Client()` and the provider
SDKs inside the registry builder. Measure on a Vercel preview with `x-vercel-cache` and wide-event `duration_ms` on a
cold instance before and after. Low confidence until measured.

### 8. Instant upload fetches back its own file

`ingestUpload` PUTs the bytes (`pipeline.ts:181`). `runJobNow` then runs `runExtraction`, which does
`repo.get` plus `storage.get(key)` (`:244`, `:283`) for bytes the route already holds. Change: pass the bytes to the
first in-request attempt through an optional `prefetched` on the job context, falling back to `storage.get`. It saves
one R2 GET (latency not measured, iad1 to R2) plus one `repo.get` query per instant upload. Risk: keep the durable
path unchanged for retries and the drain.

### 9. Pool settings (open since the 11-07 database review)

`postgres(..., { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 })` (`db/src/index.ts:589`). There is
no `max_lifetime`, and the pool lives in a module-level `Map`, not on `globalThis`. `DATABASE_POOL_MAX` isn't listed
in `docs/production-environment.md`, so production uses 5 per instance. The load test peaked at 10 connections
(`bench/README.md`). Change: `max_lifetime: 1800`, set `DATABASE_POOL_MAX=3` on Vercel, and add the role-level
`statement_timeout` from `2026-11-07-full-database.md` item 6.

### 10. Smaller items

- Fonts (`app/layout.tsx:11-22`): DM Sans with `opsz` (62 KB) and JetBrains Mono (40 KB) are both preloaded on every
  page (seen in `index.html`). `preload: false` on mono if it isn't in the hero's first paint. Open since 11-06.
- `/admin/operations` ships 397 KB gz, with recharts (107 KB gz) loaded eagerly from `components/admin/ops/charts.tsx`.
  Wrap it the way `dashboard/lazy-charts.tsx` already does. Admin only.
- The better-auth client with all four plugins (`lib/auth-client.ts`, 20 KB gz) is on every `/app` page for sign-out
  and workspace switching. A slim client for the shell could save about 10 KB. Low priority.
- Build warning: `telemetry/logger.ts:34` uses `process.pid` in the Edge bundle (proxy, instrumentation). Not a perf
  issue, but it is a warning in every build.
- Stale comment: `ocr.ts:21` says the upload route's `maxDuration` is 60 s; it is 300 (`api/receipts/route.ts:32`).

## Checked and fine (no change proposed)

- Static vs dynamic: the landing page, legal pages and `/forgot-password` are static (`○`). `/sign-in` and `/sign-up`
  are dynamic because they read `searchParams` and redirect signed-in users; leave them while #126 and #132 are open.
  The proxy matcher covers only `/app` and `/admin` (`proxy.ts:58`).
- Landing: no raster images (CSS hero), HTML 150 KB raw / 22 KB gz, `next/font` with swap.
- Streaming: `/app`, history and upload pages use Suspense, with `Promise.all` where reads are independent. The detail
  page loads four reads in one `Promise.all`.
- Indexes after #127: `receipts(org, created_at)`, `(org, receipt_date)`, `jobs_receipt_live_idx`, `member_org_user_idx`
  and `session_token_idx` cover the hot reads. The spend query bounds its scan by `created_at` (`spend.ts:147-168`).
- Effect runtime is built once per process (`lib/runtime.ts`); settings are cached 30 s (`settings.ts:240`).
- OCR cost and latency: Haiku 5.5 runs at $0.0006 a receipt, p50 1.8 s on the app's prep, with no accuracy loss from
  shrinking (`bench/results/2026-11-07-real.md`). Prep targets 3 MP and 500 KB. `maxOutputTokens` is a cap, not a
  charge. A 30 s step timeout inside a 50 s chain deadline with one in-call retry is reasonable.
- Infra: the drain runs every 5 minutes from pg_cron (about 8,600 calls a month, `docs/decisions.md:17`). Each
  in-request `after()` drain holds its function only while its own job is retrying (`MAX_WAIT_MS` 90 s,
  `lib/jobs.ts:25`). R2 egress is free, and Resend volume is one welcome mail per user plus notices. The binding
  limit is Hobby's non-commercial rule, not usage.

## Implementation plan (small PRs, in order)

1. `perf(web): lazy consent dialog, banner and install card`. Finding 1. Measure with the appendix script and
   attach before/after per route.
2. `perf(core): keep zod schemas out of group-rules`. Finding 2.
3. `perf(storage): cacheable receipt image URLs`. Finding 3, plus `<img>` width/height.
4. `test: timeouts and relative bounds for timing-sensitive tests`. Finding 5, and the base64 fixture. Rebase on
   test/wiring first.
5. `ci: one typecheck per job; Playwright workers 3`. Finding 4. Land after #131 and observability-otlp, and compare
   e2e job time over 5 runs.
6. `perf(api): slim receipt poll; Better Auth joins`. Finding 6. Land after #132 and billing-paddle merge `lib/auth.ts`.
7. `perf(db): pool lifetime and size`. Finding 9, after billing-paddle.
8. Measure first, then decide: lazy SDK imports (7) and the in-memory first attempt (8), only if a Vercel preview shows
   cold-start or upload latency worth it.

## Appendix: per-route client JS (gz KB, b0069d2 build)

`/admin/operations` 397 · `/app/receipts/[id]` 331 · `/app/history` 330 · `/app/groups` 311 · other `/app` and
`/admin` pages 275 to 295 · `/sign-in` and `/sign-up` 216 · `/` 192 · `/privacy`, `/terms`, `/cookies` 188. Method:
`build-manifest.json` `rootMainFiles` plus the union of `entryJSFiles` in each
`server/app/**/page_client-reference-manifest.js`, gzip level 9. The script is at
`/tmp/claude-1000/-workspaces-receipt-ocr-app/27a05ff3-085a-4f7d-8cb9-bcc0ee2f1d39/scratchpad/s/sizes.mjs`, which
will not survive this session; copy it into `scripts/` if the numbers should be tracked.
