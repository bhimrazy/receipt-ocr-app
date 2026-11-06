# Production readiness audit (2026-11-06)

Scope: `main` at `19facf1`, read-only. Inputs: `AGENTS.md` (incl. Working Principles), `docs/STATUS.md`,
`docs/deployment.md`, every file in `docs/plans/` and `docs/reviews/`, the open PRs (#31, #32), the worktrees
(`receipt-ocr-jobs`, `-turnstile`, `-ux`, `-load`, `-quick`, `-archdocs`) and the `research` branch. Platform limits
were checked against vendor pages today (Vercel Hobby docs, Supabase pricing, Resend pricing, Google AI Studio billing).
GitHub settings were read with `gh api`.

This report does not repeat findings that existing reviews already cover. Where it agrees with them it cites them; where
the evidence says the order should change, it says so.

## 1. Summary

The app itself is in good shape: workspace isolation, the usage ledger, upload hardening, supply-chain pins and the
admin panel are solid and tested. What is missing is almost all outside the code: the hosting plans, backups, email
limits, monitoring, legal accuracy and a way to pay. Three facts found today change the plan:

1. **Vercel Hobby keeps runtime logs for 1 hour** and, if a usage limit is exceeded, pauses that feature for up to
   30 days. Hobby is also non-commercial only. Today the wide-event logs are the only record of errors, so anything
   older than an hour is gone. This moves an Axiom log sink to the front of the observability track (the CEO review's
   "defer Axiom" no longer holds) and makes Vercel Pro a precondition for any launch push, not only for billing.
2. **Resend Free allows 100 emails a day**, and in production an undelivered verification email fails the sign-up
   request (`apps/web/lib/auth.ts:53-58`). A busy launch day would block sign-ups after about 100 people. Domain
   authentication (SPF, DKIM, DMARC) is not mentioned anywhere in the docs.
3. **The repository is public, with no branch protection, no deployment branch policy on the `vercel` environment, no
   licence, no SECURITY.md, private vulnerability reporting off and Dependabot security alerts off.** Combined with
   security audit M3 (preview builds run PR code next to `VERCEL_TOKEN`), this is the cheapest serious risk to close.

Supabase's plan is not recorded anywhere. If production is on Free, it has **no backups** and pauses after a week
idle. `docs/deployment.md` step 3 ("check point-in-time recovery") assumes a feature Free does not have.

## 2. What was checked and what is already known

Already covered elsewhere, not repeated here (see the source for detail):

- Better Auth advisories M1 and M2, and L5 (manual deploy from any branch): fixed in open PR #32
  (`fix/auth-mitigations`). Upgrade to 1.7.16 after the cooldown ends on 2026-11-10 (STATUS decision 1).
- Preview isolation M3, body streaming L1, PDF page cap L2, CSP report endpoint L3, `bun audit` blind spot L4, compose
  Postgres bound to `0.0.0.0` L6: [security audit](../../docs/reviews/2026-11-06-security-audit.md). Only M3 and L5
  are touched by running work (L5 in #32). L1, L2, L3, L4, L6 are not yet assigned.
- Telemetry privacy requirements (B1 AI errors carry receipt content, B2 proxies forward cookies, and so on):
  [security plan review](../../docs/reviews/2026-11-06-security-plan.md).
- Claims the landing page can't back up: [CEO review](../../docs/reviews/2026-11-06-ceo.md) section 5. Still present on
  `main` (`apps/web/components/landing-page.tsx:61`, `:115-124`, `:382`, `:404`). The `receipt-ocr-ux` worktree has
  uncommitted edits to `landing-page.tsx`, so the UX sweep probably covers part of this.
- Cost model, thinking tokens, Docling "no": [extraction cost and accuracy](../../docs/plans/2026-11-06-extraction-cost-accuracy.md).
- Job queue design: [jobs queue plan](../../docs/plans/2026-11-06-jobs-queue.md).

Running work and what it covers:

| Track | Where | State on disk today | Covers |
| --- | --- | --- | --- |
| Auth mitigations | PR #32 | Open, ready | M1, M2, L5 |
| Best-practice quick wins | PR #31 (draft), `receipt-ocr-quick` | 8 commits plus uncommitted work | Global error boundary, request-error logging in `instrumentation`, skip link, reduced motion, lab pages hidden unless `LAB_PAGES=1`, lighter polling |
| UX sweep | `fix/ux-sweep`, `receipt-ocr-ux` | Uncommitted edits to landing, upload panel, settings, receipt result, `files.ts` | Probably the claims sweep and PDF/upload copy. Confirm |
| Job queue | `feat/jobs-core`, `receipt-ocr-jobs` | No commits yet | Durable OCR, retries, admin queue page |
| Turnstile | `feat/turnstile`, `receipt-ocr-turnstile` | No commits yet | Bot protection on auth forms and contact |
| Load tests | `test/load`, `receipt-ocr-load` | 1 commit plus a draft results file | Capacity numbers. The draft shows uploads failing 100% at 1/s and reads failing at 30/s with 475 req/s, which looks like a rate limit or harness error, not capacity. Do not quote these numbers yet |
| Architecture docs | `docs/architecture`, `receipt-ocr-archdocs` | Uncommitted `docs/architecture/*.md` | Documentation only |
| Usage screens, observability, passkeys | Plans only | Not started on disk | As in STATUS roadmap 2, 3, 6 |

Not covered by any running work: hosting plan upgrade, backups and restore drill, email DNS and volume, health check,
uptime monitoring, incident runbook, cost alerts, legal page accuracy, GDPR export, security emails, session list,
billing, sample receipt, benchmark regression gate, repository security settings.

## 3. Four lenses

Each lens ends with the points where it checked or changed another lens's conclusion.

### 3.1 Principal engineer

**Architecture.** The package boundaries are right and mostly respected (`packages/ai` one call, `packages/core`
routing and workflows, thin routes). The usage ledger (`ocr_rounds`, `ocr_calls`) is the correct durable source for
quota and cost. Effect is used more widely than it needs to be, but the CTO review already judged that "fine to leave"
and I agree: removing it now is churn.

**Irreversible or expensive-to-reverse decisions, in the order they bite:**

1. **Plan ownership and quota unit** (user vs workspace, day vs month). Today quota is per user per day
   (`packages/core/src/plans.ts:31-32`). Once someone pays for a plan, changing who owns it means migrating
   subscriptions. Decide before billing, not after. The usage design already supports both periods, so screens are not
   blocked.
2. **Payment provider: merchant of record vs Stripe.** The target is cross-border freelancers, so VAT/GST collection is
   real work. A merchant of record (Paddle, Polar, Lemon Squeezy) removes it; Stripe Tax keeps you liable. Hard to
   switch once subscriptions exist.
3. **Hosting before the job queue ships its execution adapter.** The jobs plan builds for Hobby: drain route, Supabase
   `pg_cron` + `pg_net`, a Vault secret and a daily Vercel cron (jobs plan section 6). On Vercel Pro, a per-minute
   Vercel cron or a worker replaces the `pg_cron`/`pg_net`/Vault path. Since Pro is needed for commercial use anyway,
   decide the hosting date before Track B so Track B builds one trigger path, not two.
4. **Public repository history.** The repo is public with no licence (`gh api repos/...` returns `license: null`), so
   it is "all rights reserved" but readable by anyone, including the security docs that describe exploitable issues
   before fixes land (for example M1 was documented in `main` while #32 is still open). Decide public with a licence
   and a disclosure policy, or private.
5. **Money precision.** Amounts are `numeric(12,2)` (`packages/db/src/index.ts:75-78,118-119`). Kuwaiti, Bahraini,
   Omani, Jordanian and Tunisian currencies use 3 decimals. For a cross-border product this silently rounds. Widening to
   `numeric(14,3)` is a safe migration now and harder later when exports depend on it. Low priority, but cheap.

**What to delete** (agrees with the CTO review, still open): `app/(lab)` and `components/marketing` (about 41% of TS,
blocked on the homepage decision; PR #31 hides them meanwhile), `user_credentials` and `receipts.storage_source`,
`apps/web/lib/receipt-permissions.ts`, `RetryClaim.imageObjectKey`, the instant upload mode (the jobs plan drops it).

**Trim the job queue v1.** The plan's migration 0008 adds five tables (`jobs`, `job_workers`, `job_controls`,
`rate_windows`, `job_schedules`). One job kind exists. Ship `jobs` (plus the `ocr_calls` change) in Track A and leave
the other four to Track D, when a provider rate limit or a schedule is actually needed. Same design, less code to keep
correct.

**Tech debt that will hurt in three months:**

- Zod only at some boundaries (STATUS "Known follow-ups"). Billing webhooks will add more untrusted input; fix the
  pattern first.
- Docs drift (at time of audit; fixed in #39): STATUS said "last updated after #27" while #28 to #33 have merged and seven tracks are running.
  `AGENTS.md` still says "Future jobs: BullMQ + Redis later" (jobs plan decision 7).
- No owner-visible record of security events (sign-in, password change, session revoke). The admin audit log covers
  admin actions only. Adding this after billing means backfilling nothing, but support cases will need it.
- Storage purge failures are logged and dropped (`packages/core/src/admin.ts:69-75`), so orphaned files can
  accumulate in R2 with no reconciliation. A weekly orphan sweep can be a job kind later.

**Cross-checks.** On infrastructure: agree Pro is needed; it also simplifies the job queue (point 3). On research:
the benchmark should be built before the second provider, as planned, and before the cheap-first cascade. On product:
billing is blocked by decisions 1 and 2 above, not by engineering effort.

### 3.2 Senior research engineer

**Where accuracy stands.** Nothing is measured. The benchmark harness exists and its scorer is unit-tested
(`bench/score.ts`, `bench/score.test.ts`), but it has 5 synthetic fixtures and `bench/results/` is empty. The research
branch holds an unmerged evaluation playbook (`research/receipt-ocr-evaluation-playbook.md`) with a dataset matrix and
validation rules that overlap the parsers survey; fold the dataset matrix into `bench/README.md` and drop the rest.

**Validation and confidence.** "Needs review" is the model's own confidence below 0.9 (`packages/core/src/repository.ts:142`).
That number is self-reported and uncalibrated. The schema caps lengths (`packages/ai/src/schema.ts`) but does not check:

- arithmetic (items vs subtotal, subtotal + tax + tip vs total, quantity times unit price),
- `receiptDate` format or plausibility (it is a free string up to 32 characters, `schema.ts:10`),
- `currency` against ISO 4217 (`length(3)` only, `schema.ts:12`).

Deterministic checks are already roadmap item 4. Add date and currency validation to the same change; they are the
same size and catch the same class of silent error.

**Cost.** The ledger now stores tokens and cost per call, so real cost per receipt will be known within days of
running migration `0007` in production. That data should replace the estimates in the CEO and cost plans before any
price is set. Time pressure: Gemini 3.8 Flash prices double on 2027-01-01 (CEO review section 4), eight weeks away.
The thinking-level change and the Flash-Lite cascade need benchmark evidence before then.

**Evaluation plan (new: the regression gate).**

1. Dataset: 30 to 50 real, PII-stripped receipts (the plans say 20 to 30; 30 is the minimum to see a 10-point
   difference with any confidence). Cover thermal, skew, crumpled, HEIC, PDF, multi-currency, 3-decimal currency,
   handwritten totals.
2. Headline metric: **"row usable without edits"** (merchant, date, currency, total, tax all correct). Keep the per-field
   scores and items F1 as diagnostics. Report cost per usable row, not cost per call.
3. Calibration: on the benchmark, measure how well "needs review" predicts a wrong field (precision and recall at the
   0.9 threshold, and with the arithmetic checks). Set the threshold from data.
4. Live accuracy without PostHog: `receipts.raw_json` keeps the model output and the row holds the user's corrections,
   so the edit rate per field and per model is a SQL query. Put it on the admin usage page. This is the CEO review's
   "trust funnel" without waiting for analytics.
5. **Regression gate in CI.** Model calls can't run on every PR without a key. Add:
   - a manual and weekly `bench.yml` workflow in its own GitHub environment with a separate Gemini key that has a
     project spend cap (for example $5 a month), which commits `bench/results/<date>.md`;
   - a PR check that fails when `packages/ai/src/{schema,extract,models}.ts`, the prompt, or the admin default chain
     changes without a new results file whose headline score is within an agreed tolerance (for example no more than
     2 points below the last committed baseline).
6. Model admission rule (already in the plans): no model enters the chain without a committed result.

**Parser choice.** Agree with the existing verdicts: no Docling or OCR-first pipeline, no cloud receipt APIs, one
benchmark slot each for Qwen3-VL-8B, LlamaExtract and Mistral OCR. Nothing new here.

**Cross-checks.** On product: the landing page's "100% of line items" claim (`landing-page.tsx:61`) should be replaced
by the benchmark's headline number once it exists, not by another unmeasured claim. On infrastructure: the benchmark key
must not be the production key; on Free tier Gemini, inputs can be used by Google (STATUS production to-dos).
On principal engineering: the cascade (Flash-Lite first) adds a second code path in the chain; ship it only if the
benchmark shows at least 30% lower cost per usable row.

### 3.3 Infrastructure engineer

**Platform limits that matter (checked 2026-11-06):**

| Platform | Plan in use | Limit that matters | Source |
| --- | --- | --- | --- |
| Vercel | Hobby (`preview.yml:52` comment "free plan") | Non-commercial only. Runtime logs kept 1 hour. No spend management. No log drains. Exceeding an included limit pauses that feature until 30 days have passed. Cron once a day. 100 deployments a day. 4.5 MB request body | vercel.com/docs/plans/hobby |
| Supabase | Not recorded | Free: no backups, no PITR, paused after 1 week idle, 1 day of logs, 500 MB. Pro ($25): daily backups kept 7 days, never paused, 7 days of logs, 60 direct / 200 pooler connections on Micro. PITR $100 a month per 7 days | supabase.com/pricing |
| Resend | Not recorded (presumably Free) | Free: 100 emails a day, 3,000 a month. Pro $20: 50,000 a month, no daily cap | resend.com/pricing |
| Gemini | Paid project required (STATUS) | Billing-account tier caps ($250 a month at Tier 1). Project spend caps exist (experimental) in AI Studio, Spend page | aistudio.google.com/docs/billing |
| R2 | Unknown | Free egress. Deleted objects are not recoverable unless you replicate them; database backups do not include files. Verify bucket lifecycle and whether versioning is available on your account | Cloudflare docs (verify) |

**Health checks and monitoring.** No health route exists (`apps/web/app/api/` has auth, contact, receipts only). No
uptime monitor, no alerting, no status page. Add `GET /api/health` that runs `select 1` with a short timeout and returns
`{ ok, commit }`, never secrets or dependency details. Point an external uptime monitor at `/` and `/api/health` every
minute with email and phone alerts. Most uptime tools include a free public status page; use it when paying users
exist.

**Logs and alerting.** `apps/web/lib/log.ts:15-27` writes one JSON line per request to stdout. On Hobby that lives
for an hour. Ship the Axiom sink from the observability plan first (no drain needed, works on Hobby and Docker), then
Sentry server-side. Alerts worth having on day one: 5xx rate, `receipt.failed` rate by kind, `email.failed`, daily
OCR cost over a threshold (from `ocr_calls`), and `http.client_ip_unresolved` (should never fire).

**Cost alerts.** Three layers, none in place today:

1. `OCR_DAILY_CAP` set in production (STATUS to-do, still open).
2. Gemini project spend cap plus a Google Cloud billing budget alert at 50%, 90% and 100%.
3. Vercel spend management, which needs Pro. Until then, the risk on Hobby is not a bill but a 30-day pause.

**Backups and disaster recovery.**

- Confirm the Supabase plan. If Free, move to Pro before real users store receipts. Daily backups with 7 days of
  retention are enough for now; PITR at $100 a month is not justified yet.
- Add a weekly logical backup outside Supabase (`pg_dump` from a scheduled workflow, encrypted, stored in a separate
  R2 bucket with its own token). It protects against account loss and gives a file you can restore anywhere.
- Run one restore drill and write down the result: restore the latest backup into a scratch project, run
  `bun run db:migrate` (should be a no-op), run the smoke test from `docs/deployment.md` step 7, record time taken.
  That number is your recovery time objective.
- Receipt files: decide whether loss of R2 objects is acceptable (users can re-upload) or whether to replicate the
  bucket. State the answer in the privacy page's retention section either way.

**Environments.** Today preview and production share the `vercel` GitHub environment and presumably the same Vercel
token (security audit M3). Required:

- `vercel` environment: deployment branch policy `main` only (`gh api .../environments` shows
  `deployment_branch_policy: null`).
- A `vercel-preview` environment with a token that can't deploy production, split build and deploy jobs (M3 fix).
- Vercel Preview env: its own database (a Supabase branch or a second free project), its own `BETTER_AUTH_SECRET`, a
  capped Gemini key, and Vercel Authentication on preview deployments (available on Hobby).
- Until that exists, consider turning preview deploys off for same-repo PRs from agents.

**Email.** Verify the sending domain in Resend (SPF and DKIM records it gives you), publish DMARC starting at
`p=none` with a reporting address, move to `p=quarantine` after two clean weeks. Use a subdomain for sending (for
example `mail.<domain>`) so the root domain's reputation is separate. Move to Resend Pro before any launch push
because of the 100-a-day cap. Add `email.failed` to alerts.

**Incident runbook.** None exists. Write `docs/runbook.md` with one short section each: site down, Gemini outage or
429 storm (switch chain in Admin, settings), cost spike (lower `OCR_DAILY_CAP`, check `ocr_calls` by user), database
down or paused, R2 down, leaked secret (rotation steps already in `docs/deployment.md`; add Gemini, R2, Resend, OAuth,
Vercel token), compromised account (ban, revoke sessions, audit log), bad deploy (promote previous), bad migration
(restore). Each with who to contact and the exact dashboard or command.

**Secrets rotation.** `BETTER_AUTH_SECRETS` rotation is documented (`docs/deployment.md` "Rotating the auth secret")
and versioned. Nothing covers the other secrets. Add a table: secret, where it lives, how to rotate, what breaks
(for example rotating the R2 key needs a redeploy; rotating OAuth secrets breaks in-flight sign-ins only). Set a
yearly rotation reminder and rotate immediately after anyone with access leaves.

**Load capacity.** The load test is in flight and its first results are not usable yet (see section 2). One known
limit: the DB pool is 5 per instance (`packages/db/src/index.ts:326`) on the transaction pooler, which is fine; Vercel
Fluid concurrency means many instances, so watch pooler client counts on Supabase Free during the test.

**Region.** The CTO review noted that Vercel-to-Supabase round trips dominate latency and that the regions were not
verified. Put both in the same region and write it in `docs/deployment.md`.

**Cross-checks.** On principal engineering: agree the job queue should wait for the hosting decision, because Pro
removes the `pg_cron` path. On product: billing cannot launch on Hobby (terms), and sign-up cannot survive a launch
day on Resend Free. On research: the benchmark workflow needs its own environment and capped key; it is an
infrastructure task as much as a research one.

### 3.4 Product

**What a freelancer or bookkeeper needs before paying,** in order, building on the CEO review section 3 (still the
right list; only items 1 and 2 changed status):

1. **Honest site and a price.** Still not done on `main` (BYOK, "100%", "Let's talk"). Likely in the UX sweep.
2. **PDF in the upload UI.** Done in #25.
3. **A way to pay.** No billing, no checkout, no invoices, no refund terms. Blocked by decisions (plan unit, period,
   prices, payment provider) and by Vercel Pro.
4. **Review speed** (image beside fields, highlight what to check, next-to-review). This is where the arithmetic checks
   turn into visible value.
5. **Duplicate warning, per-currency totals, accountant export templates.** As planned.

**Onboarding.** No sample receipt in the app (`public/sample-receipts.csv` is a sample export, not a sample upload).
A first-time user without a receipt to hand sees an empty upload panel. Add "Try a sample receipt": a bundled image
that runs through the fixture result path, costs no quota and no model call, and shows the result page. Small, and it
also serves the landing page.

**Trust signals.** Missing today: a named company or person behind the service (terms and privacy name no legal
entity), a published benchmark number, a list of sub-processors, a security page (how data is stored, who can see it,
2FA once shipped), and a status page. Each is small; together they decide whether a bookkeeper hands over client
receipts.

**Limits UX.** The usage design is thorough and covers period copy, meters and limit-reached states. One addition: the
limit-reached state needs an upgrade path, which needs billing. Until then it should say when it resets and how to
contact support.

**GDPR and privacy self-service.**

- Account deletion: present (`apps/web/lib/auth.ts:163-169`, Settings). But the privacy page says deleting your account
  removes "the receipts you uploaded and their files" (`apps/web/app/privacy/page.tsx:52`), while the code keeps
  receipts you uploaded to shared workspaces, with no uploader (`apps/web/lib/auth.ts:82-86`). Fix the copy.
- Export: CSV of extracted data only. No original files, no account data. Data portability requests go to the support
  form (`privacy/page.tsx:62`). Add a "Download all my data" job (JSON plus original files as a zip, emailed link);
  this can be a job kind once the queue exists.
- Privacy page gaps: no controller identity or contact address, sub-processors not named (Vercel, Supabase, Cloudflare,
  Resend are described generically at `privacy/page.tsx:42-43`), no legal basis, no international transfer statement,
  no list of rights (access, rectification, erasure, portability, objection, complaint to a supervisory authority), no
  backup retention period (deleted data persists in backups for up to 7 days on Supabase Pro), no log retention.
- Cookie consent: not needed today; only the essential session cookie is set. It becomes needed the day browser
  analytics ships (the observability plan already says opt-in).

**Security emails and sessions.** Only three email templates exist (`packages/email/src/templates.ts`: reset,
verification, invitation). Add: password changed, new sign-in from a new device, email or 2FA changed, account
deleted, workspace ownership changed. Settings has change password with "sign out other sessions" but no list of
active sessions; Better Auth provides `listSessions` and `revokeSession`. Both are small and belong with the passkeys
and 2FA work, which adds a Security section to Settings anyway.

**i18n and currency.** English only, which is fine for now. Formatting mixes locales: numbers use `en-US`
(`apps/web/lib/format.ts:14`) and dates use `en-GB` (`format.ts:3`). Pick one, or use the browser locale for display
and ISO for export. Per-currency totals are planned. 3-decimal currencies are a data-model point (section 3.1).

**Accessibility.** PR #31 adds a skip link and reduced motion. No accessibility statement and no automated check.
Add `@axe-core/playwright` to the existing e2e smoke specs (dependency under the 7-day rule) and a short statement
page once the check runs clean.

**Support.** A support form that mails `SUPPORT_EMAIL` exists and is rate-limited (`app/api/contact/route.ts:44-56`).
Enough for now. Add a response-time promise and a help page with the five questions users will ask (why was my receipt
not read, why does it say needs review, how do limits reset, how do I export, how do I delete).

**Cross-checks.** On engineering: billing is not "M" as the CEO review estimates once VAT, refunds, webhooks, plan
changes and downgrade states are included; plan for L and pick a merchant of record to keep it M. On infrastructure:
nothing in this list should be marketed before Vercel Pro and Resend Pro. On research: the "100%" claim must go now,
not when the benchmark lands.

## 4. SaaS checklist

Status: **present**, **partial** or **gap**. Effort: XS under an hour, S under a day, M two to four days, L a week or
more.

| # | Item | Status | Evidence | Recommendation | Covered by running work |
| --- | --- | --- | --- | --- | --- |
| 1 | Bot protection | Gap | No captcha in `apps/web/lib/auth.ts`; STATUS follow-up | Turnstile via Better Auth `captcha` plugin, as planned | Yes, Turnstile (not started) |
| 2 | MFA and passkeys | Gap | [passkeys plan](../../docs/plans/2026-11-06-passkeys-2fa.md) | As planned; required for platform admins first | Plan only |
| 3 | Rate limits per email | Gap | `auth.ts:135-146` has no rule for `/request-password-reset` or `/send-verification-email`; security audit Informational | Add per-email limits in the Turnstile PR | Add to Turnstile |
| 4 | CSP enforcement and report endpoint | Partial | Report-only, no `report-to` (`apps/web/next.config.ts:4-27`); audit L3 | `/api/csp-report` that counts, then nonces through `proxy.ts`, then enforce | No |
| 5 | security.txt and disclosure | Gap | No `public/.well-known/security.txt`, no SECURITY.md; private vulnerability reporting disabled (`gh api`) | Add both; enable private reporting | No |
| 6 | Branch protection | Gap | `gh api .../branches/main/protection` returns 404; STATUS decision 8 | Require `static`, `checks`, e2e jobs; no force push | No (owner action) |
| 7 | Deploy environment policy | Gap | `vercel` environment has `deployment_branch_policy: null`; audit M3, L5 | Branch policy `main`; separate preview environment and token | Partly (#32 fixes L5 in the workflow) |
| 8 | Dependency updates | Present | Dependabot weekly with 7-day cooldown (`.github/dependabot.yml`); `check:deps`; SHA-pinned actions | Turn on Dependabot security alerts (currently off); add a Better Auth advisory watch (audit L4) | No |
| 9 | Secret scanning | Present | Secret scanning and push protection enabled (`gh api`) | Keep | n/a |
| 10 | Audit log | Partial | `admin_audit_log` for admin actions (migration 0006) | Add user security events (sign-in, password, sessions, 2FA) visible to the user and admins | No |
| 11 | Data retention | Partial | Privacy page states "until you delete" and the usage record; STATUS decision 10 | Decide ledger retention (13 months suggested), log retention (Axiom dataset setting), backup retention; add a purge job kind | Jobs Track D (`usage.purge`) |
| 12 | Backups | Gap or unknown | Supabase plan not recorded; `docs/deployment.md` step 3 assumes PITR | Supabase Pro, weekly external `pg_dump`, one restore drill | No |
| 13 | Restore drill and RTO | Gap | Nothing in docs | Run once, record time, add to runbook | No |
| 14 | Status page | Gap | None | Uptime tool's free status page when paying users exist | No |
| 15 | Terms and privacy accuracy | Partial | `privacy/page.tsx:52` contradicts `auth.ts:82-86`; no legal entity, sub-processors, rights, transfers; terms have no governing law, liability cap or refund policy | Fix copy now; full legal pass before billing | No |
| 16 | Cookie consent | Present (not needed yet) | Only the session cookie | Opt-in banner only when browser analytics ships | Observability plan |
| 17 | Feature flags | Present enough | Admin settings (`app_settings`) hold runtime config; `LAB_PAGES` env in #31 | No flag service now; PostHog flags later if experiments start | n/a |
| 18 | Product analytics | Gap | No PostHog in repo | Server-side events as planned; live accuracy from `raw_json` meanwhile | Observability plan |
| 19 | Error tracking | Partial | Global error boundary and request-error logging in #31; no Sentry | Sentry server-side with the security plan's B1 scrubbing | #31 partly; observability plan |
| 20 | Logging | Partial | Wide events to stdout (`apps/web/lib/log.ts`); Vercel Hobby keeps 1 hour | Axiom sink first | Observability plan (reorder) |
| 21 | Alerting | Gap | None | Uptime, 5xx rate, OCR failure rate, `email.failed`, daily cost | No |
| 22 | Health check | Gap | No `/api/health` route | Add with `select 1`, commit, no detail | No |
| 23 | Admin tooling | Present | `/admin` users, workspaces, audit, settings (#21); ban, revoke, impersonate with reason | Add usage pages (planned) and jobs page (planned) | Usage screens, jobs Track C |
| 24 | Abuse handling | Partial | Ban, quota ledger, `OCR_DAILY_CAP` (unset); delete-and-resign-up resets per-user quota (audit Informational) | Set the cap; Turnstile; consider blocking disposable email domains at sign-up; abuse contact in security.txt | Turnstile |
| 25 | Email deliverability | Gap | No SPF/DKIM/DMARC guidance in `docs/deployment.md`; Resend Free 100/day; production fails sign-up on undelivered mail (`auth.ts:53-58`) | Verify domain, DMARC, sending subdomain, Resend Pro before launch, alert on `email.failed` | No |
| 26 | SEO | Partial | robots, sitemap, canonical, OG image present (`app/robots.ts`, `app/sitemap.ts`, `lib/site.ts`); lab pages hidden in #31 | Fix claims; programmatic pages later (market review) | #31, UX sweep |
| 27 | Performance budgets | Gap | Bundle sizes measured once in the CTO review; no CI check | First-load JS budget per route in CI (fail over, for example, 280 KB gzip on `/app`) | No |
| 28 | Load capacity | Partial | k6 script exists; load track draft results unusable yet | Fix the harness failures, then record capacity per Vercel instance and Supabase plan | Load tests |
| 29 | Billing and checkout | Gap | No payment code; terms say paid plans aren't available | Decide unit, period, prices, provider; merchant of record recommended | No |
| 30 | GDPR export | Partial | CSV of extracted data only | Full export job (JSON plus files) | No |
| 31 | Account deletion | Present | `auth.ts:163-169`, Settings | Fix privacy copy; send an "account deleted" email | No |
| 32 | Session management | Partial | Change password can sign out others; no session list | Session list and revoke in Settings, Security | Pair with passkeys PR A |
| 33 | Security emails | Gap | Three templates only | Password changed, new device sign-in, 2FA changed, account deleted | Pair with passkeys PR A |
| 34 | i18n and currency | Partial | English only; mixed `en-US` / `en-GB` formatting; `numeric(12,2)` | One locale rule; per-currency totals (planned); `numeric(14,3)` | No |
| 35 | Accessibility | Partial | Skip link, reduced motion in #31 | axe in e2e, then a statement page | #31 partly |
| 36 | Support | Present | Contact form to `SUPPORT_EMAIL`, rate-limited | Help page with top questions; response-time promise | No |
| 37 | Onboarding sample | Gap | No sample upload | "Try a sample receipt" with no quota and no model call | No |
| 38 | Cost alerts | Gap | `OCR_DAILY_CAP` unset by default (`packages/core/src/config.ts:40`) | Cap, Gemini spend cap, Cloud budget alert, Vercel spend management on Pro | No |
| 39 | Secrets rotation | Partial | Auth secret rotation documented | Table for every other secret; yearly reminder | No |
| 40 | Environments and preview isolation | Gap | Audit M3; shared environment | Separate preview DB, secret, capped key, token; Vercel Authentication on previews | No |
| 41 | Evaluation and regression gate | Gap | 5 synthetic fixtures, no results, no CI gate | Real set, committed baseline, weekly bench workflow, PR check on model-affecting changes | No |
| 42 | Licence | Gap | Public repo, `license: null` | Owner decision: licence or private | No |

## 5. Ranked roadmap

This merges with the STATUS roadmap. Items already in STATUS keep their STATUS number in brackets. **Owner** marks a
step that needs an owner decision or a dashboard action only the owner can take.

### Now (this week; before inviting anyone beyond friends)

| Rank | Action | Effort | Owner | Notes |
| --- | --- | --- | --- | --- |
| 1 | Merge #32; upgrade Better Auth to 1.7.16 on 2026-11-10; run the M1 data audit query from the security audit | XS | Owner (decision 1) | Running work |
| 2 | Lock down the repo and deploys: branch protection on `main`; `vercel` environment limited to `main`; split preview build and deploy with a preview-only token; preview gets its own DB, secret and capped key, Vercel Authentication on; enable Dependabot alerts and private vulnerability reporting; add SECURITY.md and `security.txt` | S | Owner (settings, Vercel dashboard) | Closes M3, STATUS decision 8. Pause agent-pushed previews until done |
| 3 | Finish the STATUS production to-dos (migrations 0006/0007, env vars, paid Gemini key) and add cost guards: set `OCR_DAILY_CAP`, Gemini project spend cap, Cloud billing budget alert | XS | Owner | Existing to-dos plus two dashboard settings |
| 4 | Data safety: record the Supabase plan; move to Pro if Free; weekly external `pg_dump`; one restore drill with the time recorded; co-locate Vercel and Supabase regions | S | Owner (plan, $25/mo) | Not covered by any track |
| 5 | Email: verify the Resend domain (SPF, DKIM), publish DMARC `p=none`, sending subdomain, document in `docs/deployment.md`; plan Resend Pro before any launch push | XS | Owner (DNS) | Not covered |
| 6 | Observability A, reordered: Axiom sink first, then Sentry server-side with B1 scrubbing [3] | S then S | Owner (decision 6, server-only) | Moved ahead of or in parallel with usage screens because Hobby keeps 1 hour of logs |
| 7 | Health route, external uptime monitor with alerts, and `docs/runbook.md` (incidents, secret rotation table) | S | No | Not covered |
| 8 | Honesty pass: landing claims (BYOK, "100%", "Let's talk"), privacy deletion sentence, name sub-processors, add controller and contact, rights, backup and log retention | S | Owner (legal entity, contact address) | UX sweep likely covers the landing part; legal copy is not covered |
| 9 | Accuracy quick wins [4]: arithmetic checks plus date and currency validation driving "needs review"; PDF page cap (audit L2); bench thinking `low` vs `medium` on the 5 fixtures to start | S | No | Bench needs a key in its own environment |
| 10 | Turnstile plus per-email limits on reset and verification | S | No | Running work; add per-email limits to its scope |

### Next (before taking money, about 2 to 4 weeks)

| Rank | Action | Effort | Owner | Notes |
| --- | --- | --- | --- | --- |
| 11 | Decide and move hosting to commercial: Vercel Pro, Supabase Pro (if not done), Resend Pro | XS | Owner ($20 + $25 + $20 a month) | Do before jobs Track B so it builds one trigger path |
| 12 | Job queue Tracks A and B, with v1 trimmed to the `jobs` table [jobs plan] | M + M | Owner (jobs decisions 1 to 7) | Running work. On Pro, use per-minute Vercel cron or a worker instead of `pg_cron` + Vault |
| 13 | Usage screens [2] | M | Owner (decision 4, cost visibility) | Unchanged; add the live edit-rate metric from `raw_json` to the admin page |
| 14 | Real benchmark set (30 to 50), committed baseline, weekly bench workflow, PR regression check | M | Owner (budget, receipts) | New; precondition for [4] cascade and [5] second provider. Before 2027-01-01 price change |
| 15 | Plan decisions then billing: plan unit and period [STATUS 3, members plan], prices, merchant of record, checkout, upgrade from limit-reached, refund and VAT terms [7] | L | Owner | Blocked on 11 and the decisions |
| 16 | Passkeys and 2FA [6], with session list, revoke and security emails in PR A | M + M | Owner (decision 11) | Plan exists; scope widened |
| 17 | "Try a sample receipt" in the app and on the landing page | S | No | New |
| 18 | CSP report endpoint, then nonces and enforcement (audit L3); L1, L6 fixes | S | No | Not assigned today |
| 19 | Delete lab code, BYOK tables, duplicate permission helper [STATUS decisions 2, 9] | S | Owner (homepage) | About 15k lines less |
| 20 | Load test results recorded per plan, after the harness is fixed | S | No | Running work |

### Later (with paying users)

| Rank | Action | Effort | Owner | Notes |
| --- | --- | --- | --- | --- |
| 21 | Full GDPR export job (JSON plus files) and retention purge jobs | M | Owner (decision 10) | Uses the job queue |
| 22 | Cheap-first cascade, then second provider [4, 5] | M each | Owner (decision 5) | Only if the benchmark shows a 30% or larger cost win |
| 23 | Product items [8]: review view, duplicates, per-currency totals, accountant exports, email-in | L | Owner (wedge) | CEO review order |
| 24 | Members, seats, per-workspace quota [7] | M | Owner (decision 7) | Plan exists |
| 25 | Public status page, help centre, accessibility statement with axe in CI, performance budget in CI | S each | No | |
| 26 | Browser PostHog with opt-in consent banner | S | Owner (decision 6) | Observability track C |
| 27 | `numeric(14,3)` amounts; one locale rule for display | S | No | Before accountant exports ship |
| 28 | User-visible security event log; orphaned R2 object sweep | S each | No | |

### Changes to the STATUS order

- **Move** Axiom (part of [3]) ahead of, or in parallel with, usage screens [2]. Reason: 1-hour log retention on Hobby.
- **Insert** infrastructure steps 2 to 5 and 7 above the product roadmap. None of them is in STATUS today.
- **Insert** hosting upgrade (11) before jobs Track B and before billing [7].
- **Insert** the benchmark regression gate (14) as the first half of [4]; the cascade becomes the second half.
- **Widen** passkeys PR A [6] to include session list and security emails.
- **Keep** the rest of the order.

## 6. Owner decisions

New, from this audit:

1. **When to go commercial on hosting** (Vercel Pro, Supabase Pro, Resend Pro, about $65 a month). Recommended: before
   any public launch or marketing, and before jobs Track B.
2. **Supabase plan and backup posture.** Recommended: Pro daily backups plus a weekly external dump; no PITR yet.
3. **Receipt file durability.** Accept that R2 objects lost are lost (users re-upload), or replicate the bucket.
4. **Preview environment.** Separate database, secret, capped key and token now, or turn previews off for agent PRs
   until it exists.
5. **Public repository.** Add a licence and disclosure policy, or make it private. Note that security reviews are
   published before their fixes merge.
6. **Legal identity** for terms and privacy (who the controller is, contact address, governing law), and the payment
   provider (merchant of record recommended for cross-border VAT).
7. **Benchmark budget and gate.** A separate capped Gemini key, the tolerance for the PR check, and who supplies 30 to
   50 real receipts.

Existing STATUS decisions that are now time-bound: 1 (Better Auth upgrade, 2026-11-10), 8 (branch protection, folded
into rank 2), 3 (plan unit and period, blocks billing), 6 (observability, blocks rank 6), 2 (homepage, blocks the
lab deletion).

## 7. Top 10 actions

1. Merge #32 and upgrade Better Auth on 2026-11-10.
2. Branch protection, `main`-only production environment, isolated previews (M3), repo security settings.
3. Production to-dos plus cost guards: `OCR_DAILY_CAP`, Gemini spend cap, Cloud budget alert.
4. Confirm or move to Supabase Pro, external weekly dump, one restore drill.
5. Resend domain authentication (SPF, DKIM, DMARC) and a plan for the 100-a-day cap.
6. Axiom log sink first, then Sentry server-side.
7. Health route, uptime monitor, runbook.
8. Honest landing page and accurate privacy and terms.
9. Arithmetic, date and currency checks; PDF page cap; first thinking-level bench.
10. Turnstile with per-email limits.
