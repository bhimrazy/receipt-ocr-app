# Full security review — 2026-11-07

## Security review — Changes requested

Scope: `main` at `c74fb89` (production serves `9bb941b`; #108–#110 landed mid-review, so the OpenAI provider is
covered). Read-only. Builds on [11-04](2026-11-04-security.md), the [11-06 audit](2026-11-06-security-audit.md) and
[11-06 plan review](2026-11-06-security-plan.md). Method: source and the installed Better Auth 1.7.18 dist read; unit
suites green (521 tests); production probed with unauthenticated GET/HEAD only (headers, health, `get-session`,
robots, llms.txt, drain, forged `Host`/`X-Forwarded-Host`). No compose Postgres was running, so `*.int.test.ts` were
read, not run. PR #95 (2FA/passkeys) is reviewed separately.

## Prior findings: status

Fixed and pinned: 11-04 B1 (scope re-read from `member`, `packages/core/src/workspace.ts:14-28`; `receipts.int`
"B1"), B2 (`WHERE email_verified = true`, `lib/auth.ts:137-147`; `admin-bootstrap.test.ts`), M1–M6, L1–L7, U3, U9
(`redirect.ts:122-138`; production headers; `env.ts:17-21,28-31,182-184`; `http.ts:201-237,285-316`;
`repository.ts:190-194` "P2-5"; `cookieCache` off `auth.ts:272`, `auth.int.test.ts:201`; `csv.ts:3,17`;
`storage/src/index.ts:50-52`; `env.ts:214-215,351-360`); 11-06 M1 (exact-role allowlist `auth-guards.ts:148-152` in
every org hook, `auth.int.test.ts:172`), M2, L1 (`receipts/route.ts:39-50`, `discardBody` `http.ts:270`), L2
(`MAX_PDF_PAGES = 10`, `pdf-pages.test.ts:142`), L5 (`production.yml:24-30,60-70`), per-email reset caps
(`email-limits.ts`, `auth.int.test.ts:126`); plan B1/B5 (`OcrCallError` message is kind+status `ai/src/errors.ts:104-118`,
`errorFields` never reads `message` `telemetry/redact.ts:179-199`, `route` kind cuts `?`/`#`;
`telemetry.test.ts:162,273,436-570`, `wide-events.int.test.ts:54`; caveat: `OcrError.cause` still holds the SDK error,
so a future Sentry sink needs `beforeSend`).

Still open: 11-06 M3 (M1 below), L3 (half: reports land, CSP still report-only, L1), L4 (M5), L6 (L3). No regressions.

## Blocking

None.

## High

None.

## Medium

### M1 · PR code in `vercel build` can capture `VERCEL_TOKEN`, which deploys production (11-06 M3, open)

- `.github/workflows/preview.yml:88-110`, `production.yml:129-142`. One job installs the CLI into the workspace,
  runs `vercel build` token-less but executing repository code (`next.config.ts`, a PR-added dependency's
  postinstall), then runs the **same binary** with `VERCEL_TOKEN` for `deploy`; `.vercel/.env.preview.local` is
  readable by the build too.
- Scenario: a same-repo branch (collaborator, prompt-injected agent, build-time dependency) rewrites
  `.github/vercel-cli/node_modules/vercel/dist/*.js` during build; the deploy step runs it with the shared `vercel`
  environment's token. Fork PRs and Dependabot are excluded, so this is insider or supply chain, not anonymous.
- Fix: `build` job with no secrets uploads `.vercel/output`; `deploy` job installs a fresh CLI outside the workspace
  and runs only `vercel deploy --prebuilt`. Separate Vercel project and token for previews.

### M2 · A weak `BETTER_AUTH_SECRET` only warns

- `apps/web/lib/env.ts:342-346`: `< 32` chars logs `console.warn` and the app starts. Sessions, verification and
  step-up tokens are signed with it; a short secret in Vercel means forgeable cookies that nobody notices.
- Fix: throw when `isProduction && !isBuild`, as `BETTER_AUTH_URL` does (`env.ts:182-184`); pin in `env.test.ts`.

### M3 · No per-account brute-force limit on sign-in or password change

- `apps/web/lib/auth-rate-limit.ts:7` is 5/60 s **per IP**; `/change-password` has only Better Auth's 3/10 s per IP.
  With many IPs one account's password can be guessed without bound. Turnstile is live on production (probed) and is
  the only account-level brake, but it is optional config.
- Fix: per-email failed-sign-in counter (the `hitRateLimit` pattern of `email-limits.ts`, e.g. 10 failures/h) and a
  per-user cap on `/change-password` in `hooks.before`. Pin in `auth.int`.

### M4 · Unauthenticated `/api/jobs/drain` hits are never sampled: a free log flood

- `apps/web/app/api/jobs/drain/route.ts:30-33` sets `event.notices` on every 401; `lib/http.ts:130` (`isRoutine`)
  returns false whenever notices exist, so `routine: true` never applies. Anyone can loop `GET /api/jobs/drain`
  (production answers 401 with `x-request-id`) and write one full line per request at any `LOG_SAMPLE_RATE`. No DB
  is touched; the cost is log volume and any paid drain.
- Fix: keep the rare `jobs.drain_unconfigured` notice, drop or count `jobs.drain_unauthorized` (cf.
  `/api/csp-report`'s `skipEvent`). Pin: N unauthenticated calls produce a sampled share of lines.

### M5 · Better Auth advisories still have no signal (11-06 L4, open)

- No `schedule:` trigger anywhere; `bun audit` today reports only dev-only esbuild/glob/minimatch and would have
  missed all 2026-11-03 GHSAs. Fix: Watch → Security on `better-auth/better-auth`, or a weekly job diffing
  `gh api repos/better-auth/better-auth/security-advisories` against the pinned version.

## Low

- **L1 CSP report-only with `'unsafe-inline'`** (`apps/web/lib/csp.ts:21`), confirmed on production;
  `img-src … http://localhost:9000` (`csp.ts:23`) ships to production. Reports now reach `/api/csp-report`: move to
  nonces via `proxy.ts` and enforce.
- **L2 Uncapped `request.json()`** on `apps/web/app/api/receipts/[id]/route.ts:105` (PATCH) and
  `api/contact/route.ts:53`, unlike groups (`readJson`, 16 KB). Vercel caps at 4.5 MB; on Docker a user can make the
  server buffer arbitrary JSON. Route both through `readJson` with a zod schema.
- **L3 Compose Postgres on `0.0.0.0`** with `postgres/postgres` (`docker-compose.yml:24`). Bind `127.0.0.1`.
- **L4 No last-admin guard**: `apps/web/app/admin/actions.ts:173-190` lets admin A demote the only other admin; two
  admins can leave zero, and recovery needs a DB edit. Refuse `role: "user"` when it would leave none.
- **L5 Email `url` slot accepts any absolute http(s) URL** (`packages/email/src/render.ts:56-62`). Every caller passes
  a Better Auth or `${betterAuthUrl}` link today; require the app origin so a future caller can't mail a foreign link
  under the trusted sender.
- **L6 Lease overlap can double-bill one round**: a lambda frozen past the 90 s lease (`maxDuration = 60`, ~5 s
  headroom, `lib/jobs.ts:85-88`; `jobs/runner.ts:343-360`, `queue.ts:279-292`) lets two workers run the same round,
  both priced; `complete` is fenced so only one writes. One extra provider call at most; lengthen the route's lease.
- **L7 pg_net keeps the bearer header in `net.http_request_queue` until sent**; note it in
  `docs/production-environment.md:398-451`.
- **L8 Notes**: `change-email` into an `ADMIN_EMAILS` address grants admin (`auth.ts:244`); the new inbox is proven,
  so document it. Undecodable HEIC and PDFs keep EXIF/GPS through R2 and the provider
  (`lib/capture/prepare-photo.ts:21`). `/api/csp-report` shares one limiter bucket off-Vercel (`route.ts:14`).
  `bun audit`: 4 dev-only findings.

## Verified secure

- **Tenancy**: every receipt read/write is `inScope`/`writable`/`filterWhere` on `organization_id`
  (`packages/core/src/repository.ts:186-233`); groups use `inWorkspace`, adds join on
  `receipts.organization_id = scope`, the export/history group filter re-checks `g.organization_id`
  (`groups.ts:106-118,240-262,300`, `repository.ts:216-224,630`). Pinned: `receipts.int` and `groups.int`
  "workspace isolation", `groups/routes.test.ts:287`.
- **RLS**: enabled on all 19 tables, no policies, app role owns them (`0000_baseline.sql`, `rls.int.test.ts:21-47`);
  `rls.test.ts` fails a new table without `.enableRLS()`.
- **Step-up (#92)**: `/change-email` and `/delete-user` need a session < 15 min (`auth.ts:289-316`,
  `step-up.ts:29-41`); a password in the body doesn't bypass it (`step-up.int.test.ts:114,128`); delete token 32 random
  chars, 1 h, single use, user-bound, `callbackURL` dropped (`step-up.ts:44-48`); GET callback 404'd (`auth.ts:280`);
  sole-owner check before the token is spent. Email change is approved by the **current** address first
  (`auth.ts:373-385`), closing GHSA-hwq2.
- **Rate limits** (DB store): sign-in 5/60 s, sign-up 3/60 s, invite 20/h IP + 10/h inviter, delete/change-email
  10/h IP + 3/h per address, reset/verification 3/h per hashed address (`auth-rate-limit.test.ts`,
  `auth.int.test.ts:126`).
- **OAuth linking**: `trustedProviders` empty, linking needs provider-verified and locally verified email,
  `allowDifferentEmails` unset (Better Auth `link-account.mjs:73,170-171`).
- **Admin**: `requireAdmin()` in layout, every page and every action (`admin/actions.ts:57`,
  `admin/jobs/actions.ts:36`); admins can't be banned, deleted or impersonated (`actions.ts:155-160`); impersonation
  audited; `/admin` 404s non-admins.
- **Drain**: Bearer only, SHA-256 then `timingSafeEqual`, unset secret → same 401 (`lib/cron-auth.ts:14-19`;
  `cron-auth.test.ts`, `drain/route.test.ts`); secret in Supabase Vault, read at run time; 10 jobs / 3 concurrent /
  55 s (`lib/jobs.ts:85-102`; `drain.test.ts:89,97`).
- **Queue**: `FOR UPDATE … SKIP LOCKED` claim, later writes fenced on `id, locked_by, attempts, state`
  (`queue.ts:203-269`); payloads are re-scoped at run time (`pipeline.ts:235-239`); idempotency key per round
  (`jobs.int.test.ts:308,345,459-545,780`).
- **Providers**: keys from env only (`core/src/ocr.ts:180-190`); `gsk_`, `sk-`, Bearer and hex shapes redacted
  (`telemetry/secrets.ts:10`); only `error.code`/`message` are regex-classified, never stored (`ai/src/errors.ts:70-126`);
  `invalid-output` moves the chain on, `bad-image` stops it; OpenAI `store: false` (`extract.ts:150`);
  `maxOutputTokens 16384`, bounded schema; injection guard in the system prompt (`prompt.ts:49-51`).
- **Upload**: session, Origin and scope before the body; 10 MB + 64 KB on Content-Length and the stream; magic-byte
  allowlist jpeg/png/webp/heic/heif/pdf, client type and name ignored (`files.ts:19-35`); no server-side image
  decoding; PDF counter fails closed with a 16 MB inflate budget; share target capped 20 files / 50 MB.
- **Storage**: presigned GET 10 min, content type from the sniffed extension, PDFs `attachment`
  (`storage/src/index.ts:142-162`); objects removed on receipt, user and workspace delete (`receipts.int` "U1").
- **CSV**: single `cell()` choke point plus group names, covers `= + - @ \t \r` (`csv.ts:6,14-19`; `csv.test.ts:86,95`).
- **Email**: `{{slot}}` HTML-escaped, `line` kind strips CR/LF, generator refuses slots inside attributes
  (`render.ts:98-106`, `emails/prerender.ts:40-58`; `templates.test.ts:30,110,357` with a hostile workspace name);
  `logUndelivered` only in development (`env.test.ts:279`).
- **SEO/host**: `requestHost` reads `Host` only (`seo-hosts.ts:22`); forged `X-Forwarded-Host` changed nothing on
  production, forged `Host` → 404; canonicals are constants; `X-Robots-Tag: noindex` on `/sign-in`, `/app`, `/admin`,
  `/api/*` (probed). ACAO `*` and `referrer-policy: origin` on `/` are Vercel's static layer and the analytics-path
  rule (`next.config.ts:84-89`); harmless.
- **Telemetry**: allowlisted schema with no field for headers, cookies, query or email; client `x-request-id`
  overwritten (`proxy.ts:25`); health returns only `ok` and a short SHA.
- **CI**: actions SHA-pinned; `permissions: {}`/`contents: read`; `persist-credentials: false`; no
  `pull_request_target`, no `${{ }}` in `run:`; `workflow_run` gate checks conclusion, `push`, `main`, same repo
  (`production.yml:24-30`); `db-migrate.yml` dispatch-only with environment approval; zizmor in CI; Docker base by
  digest, non-root; exact pins.

## PR #95 interactions (note only)

A passkey sign-in creates a fresh session and so satisfies step-up; passkey add/remove should itself be step-up gated.
Add `/two-factor/*` and `/passkey/*` to `authRateLimitRules` with a tight per-user TOTP cap, and keep `cookieCache`
off so trusted-device cookies don't outlive revocation.

## Owner actions

1. **Remove `minimumReleaseAgeExcludes` from `bunfig.toml:6` on 2026-11-12**: `better-auth@1.7.18` and
   `@better-auth/core@1.7.18` were published 2026-11-05 (2 days old today), `better-call@1.4.5` on 2026-11-03.
2. Separate Vercel project and token for previews; `main`-only branch policy on the `vercel` environment; confirm
   Preview vars point at staging and are Sensitive (M1).
3. Watch `better-auth/better-auth` → Security, or approve a scheduled advisory-diff workflow (M5).
4. Put `BETTER_AUTH_SECRETS=1:<current>` back in Vercel; confirm the secret is ≥ 32 chars (M2).
5. Set `OCR_DAILY_CAP`: quota still resets with account deletion (`ocr_rounds.user_id` `SET NULL`).
6. Supabase: remove `public` from the Data API's exposed schemas; run the pg_cron SQL (step 8); enable Groq ZDR.
7. Keep Turnstile on in production; schedule the CSP move to nonces and enforcement.
