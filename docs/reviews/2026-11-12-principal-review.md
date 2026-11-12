# Principal review: 2026-11-12

`main` at `297c628` (#213). Read-only: no code changed, no tests, builds or servers run, nothing remote touched. Read:
`AGENTS.md`, `docs/STATUS.md`, `docs/architecture/`, every non-test file in `packages/core/src` on the receipt, job,
quota, billing and deletion paths, `packages/db`, `packages/storage`, `packages/ai/src/{index,extract}.ts`, the receipt,
drain, webhook and auth routes, `apps/web/lib/{auth,session,jobs,quota,runtime}.ts`, and the CI and production
workflows. Production facts (backups, cron cadence, alert settings) are quoted from the dated docs, not re-checked.
Line-level bugs and test layout are in the sibling reviews; items already tracked in STATUS are cited, not restated.

## Verdict

1. The shape is right for the next 12 months: one Next app, Postgres as both queue and usage ledger, thin routes over
   `packages/core`, one provider boundary. The boundaries hold when checked (finding 11). Do not re-architect.
2. It will hurt first at the edge of the request, not in the core: the workspace is ambient session state and an
   upload has no idempotency key, so a second tab can put a receipt in the wrong workspace and a phone's retry
   creates a duplicate (3, 4).
3. Operability is behind the code: no backups, no alert reaches a person, and every merge deploys to production with
   no check afterwards. On 2026-11-09 a production hang and then an outage caused by its fix both shipped that way
   (1, 2, 5).
4. The job queue is correct (fencing, leases, idempotency) but has no runner of its own: unattended, it clears about
   three scans per five minutes, and its documented scale trigger cannot fire (6).
5. Billing is the most careful code in the repository. Hold the live Paddle keys until 1, 2 and 5 are done; spend the
   rest of the effort deleting (11) rather than building the 9,400 lines of plans.

## Findings, ranked by consequence

### 1. Nothing can be restored (S)

- **Evidence.** The database review found zero backups and PITR off in production (`docs/reviews/2026-11-09-database-review.md:52`);
  the backup PR is still a draft that needs a rebase (`docs/STATUS.md:195`), and `main` holds no backup or restore
  script (`git ls-files | grep -iE 'backup|restore'` is empty). Receipt files have one copy in one bucket; no doc
  mentions another. A workspace delete cascades receipts and items (`packages/db/src/index.ts:73-75`), and the admin
  path deletes the files right after (`packages/core/src/admin.ts:84-109`).
- **Consequence.** One bad migration, mistaken delete or compromised credential is permanent, including
  `billing_subscriptions`, the only local record of who paid.
- **Recommendation.** Merge #131, run the restore drill once and write the measured restore time and the 24 h RPO in
  the runbook. Make that a written gate for switching Paddle to live. Decide and record whether a single copy of the
  images is accepted.

### 2. Every merge reaches production unverified, and CI cannot see production's database path (M)

- **Evidence.** `production.yml` ends at `vercel deploy --prod` (`.github/workflows/production.yml:141-145`): no
  smoke check, no rollback. CI's integration and e2e jobs talk to a local Postgres directly, without a pooler or TLS
  (`.github/workflows/ci.yml:174-175`); the pooler job is a known follow-up (`docs/STATUS.md:354`). Previews do not
  yet use the staging database (`docs/STATUS.md:137`). On 2026-11-09, 39 commits landed. Two of them fixed
  failures only production could show: #210 (a statement hung behind Supavisor,
  `docs/reviews/2026-11-09-home-stuck-incident.md`) and #212 (an outage: the driver switch in #210 broke TLS against
  Supabase's CA). #205 and #213 were same-day follow-ups. 245 of the 273 commits on `main` are from 2026-11-04 to
  2026-11-09.
- **Consequence.** The next production-only failure ships the same way, and from launch it lands on paying users.
- **Recommendation.** In order: (a) after the deploy, call `/api/health/ready` (it runs `select 1` through the real
  pool, `packages/core/src/health.ts:24-26`, so it would have caught #212) and promote the previous deployment when it
  fails; (b) deploy each release to a staging Vercel target on `staging-db` through the pooler first and run the same
  check there; (c) move "release-based deploys" (`docs/STATUS.md:334`) from Later to before live billing.

### 3. The active workspace is ambient session state (S for a guard, L for workspace URLs)

- **Evidence.** Switching calls `authClient.organization.setActive` (`apps/web/components/workspace-switcher.tsx:66`),
  which changes the session row. Every route resolves the workspace from that session at request time
  (`apps/web/lib/session.ts:107-122`; `apps/web/app/api/receipts/route.ts:46`; `apps/web/app/api/groups/route.ts:18,38`);
  no request names the workspace it was rendered for. Other tabs refresh only in the installed app, after a minute
  hidden (`apps/web/components/refresh-on-return.tsx:16`).
- **Consequence.** Switch to a shared workspace in tab A, upload from tab B still showing Personal: the receipt lands
  in the shared workspace, readable by every member, and draws its quota. There is no move between workspaces. The
  same model breaks receipt links between members with different active workspaces, and cannot carry API tokens or the
  planned MCP server, which have no session.
- **Recommendation.** Now: the app shell sends the workspace id it rendered with on every mutating request, and
  `getActiveScope` callers answer 409 "you switched workspace in another tab" on a mismatch. Before any public API:
  put the workspace in the path and keep the session value only as the default redirect.

### 4. An upload cannot be retried safely (S to M)

- **Evidence.** The server makes the receipt id per request (`packages/core/src/pipeline.ts:179`). A single upload is
  sent in `instant` mode (`apps/web/components/upload-panel.tsx:420`), which holds the request open through the model
  call, up to about 61 s (`apps/web/app/api/receipts/route.ts:115`, `apps/web/lib/jobs.ts:64`). When the response is
  lost the client says "didn't reach the server ... try again" (`apps/web/lib/capture/upload-request.ts:39-43`) and
  Retry posts again. The job's idempotency key is per receipt id, so it does not cover this, although its comment
  says a replayed upload is a no-op (`packages/core/src/jobs/receipt-extract-job.ts:26,32`).
- **Consequence.** On a phone that locks or changes network mid-request: two receipts, two quota rounds, two paid
  model calls, and a user who thinks the first one failed.
- **Recommendation.** The client generates a UUID per captured file, kept across retries, and sends it; the server
  uses it as the receipt id and returns the existing receipt when the id already exists in the same workspace for the
  same user (409 otherwise). The object key derives from the id, so the second `put` overwrites the same object.
  Then make single uploads `queued` as well (finding 11): short requests lose fewer responses.

### 5. No failure reaches a person, and the billing job gives up in ten minutes (S)

- **Evidence.** Every alert, monitor and uptime step is unchecked (`docs/production-environment.md:596-621`); the one
  planned error monitor excludes `job.attempt` (`:609`), so a dead job would not match it. Readiness checks the
  database and storage only (`packages/core/src/health.ts:41-49`), not the queue. `billing.apply_event` has 8
  attempts with a 5 s base backoff (`packages/core/src/jobs/kinds/billing-apply.ts:69-71`): the seven waits sum to at
  most 635 s, then it is dead and waits for an admin to look at the jobs list. A queue-wide pause stops every kind,
  billing included (`packages/core/src/jobs/queue.ts:226,238`).
- **Consequence.** A Paddle API incident longer than ten minutes leaves a refunded or charged-back subscription
  uncancelled at the provider; pausing the queue during an OCR incident silently delays Pro for someone who just paid;
  a wrong `CRON_SECRET` on one side stops the drain with no signal outside `net._http_response`.
- **Recommendation.** (a) Do the unchecked list, plus one monitor: any `job.attempt` with `queue.outcome = dead`
  for a `billing.*` kind, and dead receipt jobs above a rate. (b) Add queue liveness to readiness (age of the newest
  `tick:*` row and of the oldest due job) so the one uptime check covers the drain. (c) Give `billing.apply_event`
  a retry window of about a day (Paddle itself retries webhooks for days). (d) Exempt `billing.*` kinds from
  the queue-wide pause, or pause by kind (`kind:receipt.extract`) during an OCR incident.

### 6. The queue has no runner of its own (S interim, M for the worker)

- **Evidence.** Jobs run inside upload, retry and poll requests (`apps/web/lib/jobs.ts:35-78`); the cron drain is the
  only runner that needs no visitor. It claims only during the first 5 s of a 55 s budget with 3 slots
  (`apps/web/lib/jobs.ts:86-89`; loop at `packages/core/src/jobs/runner.ts:167`), so a pass starts at most 3 scans
  unless they finish in under 5 s, and `capped` needs 10 runs (`packages/core/src/jobs/drain.ts:53`). Production runs
  it every 5 minutes (`docs/production-environment.md:427-430`), while the route comment and the jobs page say every
  minute (`apps/web/app/api/jobs/drain/route.ts:16`; `docs/architecture/flows/jobs.md:51`). The stale threshold is
  also exactly 5 minutes (`packages/core/src/jobs/live.ts:12`), and a queued job older than that is live only while a
  tick mark is younger than that (`live.ts:31-33`).
- **Consequence.** Anything that leaves the request path (a `Retry-After` beyond the 90 s wait, a provider cooldown,
  a killed function) drains at about 36 scans an hour unless a receipt page is open and polling. The scale trigger
  written down in the 2026-11-07 architecture review ("drains hit `capped: true`") cannot fire for scans. With the
  cron period equal to the stale threshold, the tick mark lapses for the jitter between two calls, and in that gap a
  paused or backlogged receipt reads as failed and frees its quota (`packages/core/src/repository.ts:177-179`).
- **Recommendation.** Now: schedule pg_cron every minute as designed, or raise `STALE_AFTER_MS` to at least twice
  the cron period, and write the invariant next to both. Have the drain answer 202 and keep draining in `after()`
  under the 300 s limit the upload route already uses, so the claim window is minutes, not 5 s. Fix the three stale
  comments (`apps/web/lib/jobs.ts:7`, `drain/route.ts:16`, `packages/core/src/ocr.ts:21`). Next: `apps/worker` on
  `runWorkerLoop`, which is already written; the trigger is the first week with a 429 cooldown on a batch, not `capped`.

### 7. Stored files cannot be reconciled with rows (M)

- **Evidence.** Keys are `users/<uploader>/receipts/<id>` (`packages/storage/src/index.ts:52-54`), but receipts belong
  to a workspace and outlive their uploader (`packages/db/src/index.ts:80`), so no prefix maps to a tenant and a
  deleted user's id stays in keys. The file is stored before the row exists and removed only on a typed failure
  (`packages/core/src/pipeline.ts:181,203`), not when the function is killed. A failed delete is "logged ... for a
  sweep" (`pipeline.ts:420`); no sweep exists and `packages/storage` has no list operation. `receipts` has no size
  column (`packages/db/src/index.ts:68-111`), and the owner wants a storage cap per plan (`docs/STATUS.md:363`).
  The two workspace deletions disagree on order: the admin path locks the workspace, deletes rows, then files
  (`packages/core/src/admin.ts:84-109`); the Better Auth path deletes files first, with no lock
  (`apps/web/lib/auth.ts:663-666`), so a failed delete afterwards leaves receipts without images. That endpoint is
  reachable although no screen calls it, and no test covers its hook.
- **Consequence.** Orphaned objects accumulate unseen against R2's 10 GB free tier; the storage cap needs a `HEAD`
  per object to backfill; the user path can lose images while keeping rows.
- **Recommendation.** One migration, before real users: `receipt_files (receipt_id, key, bytes, media_type,
  position)` with keys under `orgs/<workspace>/`. That gives size for the cap, a prefix per tenant, and room for
  multi-part receipts (parked, `docs/STATUS.md:320`) without a second migration. Add `listObjects` and a weekly
  `maintenance.sweep` job kind. In `beforeDeleteOrganization` only collect the keys; delete them in the after hook,
  so both paths are rows first.

### 8. Auth invariants are path denylists over a dependency's endpoint set (S to M)

- **Evidence.** The catch-all hands every Better Auth endpoint to the handler
  (`apps/web/app/api/auth/[...all]/route.ts:8,29,39`). Guards match path strings: `FIXED` and `IMPERSONATION_BLOCKED`
  (`apps/web/lib/step-up-paths.ts:13-27,60-79`), `ADMIN_GUARDED` and a chain of `ctx.path ===` branches
  (`apps/web/lib/auth.ts:136,376-451`). Only `/admin/*` is closed by default (`step-up-paths.ts:48`). No test
  lists the endpoints the installed version exposes. The code and STATUS already record behaviour that depends on the
  installed version (`auth.ts:420,428,446,633`; `docs/STATUS.md:375,436`), and `/organization/delete` (finding 7) is
  live with no UI.
- **Consequence.** An upgrade that adds or renames an endpoint is open to a signed-in user, and to an impersonating
  admin, until someone notices. The version is exempt from the 7-day cooldown today (`bunfig.toml:6`; due for removal
  after 2026-11-12, `docs/STATUS.md:186`).
- **Recommendation.** Invert it: an allowlist of the endpoints the product calls, 404 for the rest, in the catch-all.
  Add a test that snapshots the endpoint paths of `auth.api` so an upgrade fails CI until each new path is classified
  (allowed, step-up, blocked while impersonating).

### 9. The quota statement joins three subsystems on every render (M)

- **Evidence.** "Used" is counted from `ocr_rounds` with correlated lookups into `ocr_calls` and `jobs`, including a
  cast of the job's JSON payload (`packages/core/src/usage.ts:76-103`; the payload cast is `:87`). It runs twice per upload (the early
  check at `apps/web/app/api/receipts/route.ts:71`, then under the advisory lock at
  `packages/core/src/repository.ts:417-418`) and on every signed-in page through the layout
  (`apps/web/app/app/layout.tsx:39`). It is already the top statement in the load test (`docs/STATUS.md:452`) and
  36 to 187 ms at 10k receipts (`docs/reviews/2026-11-09-database-review.md:45`).
- **Consequence.** This is where Postgres saturates first, and it holds the per-user (and per-workspace on Pro) lock
  while it runs. The ledger's meaning also depends on the queue's payload shape.
- **Recommendation.** Keep the ledger as the only truth (agreeing with D5: no counter rows). Write each round's
  outcome onto `ocr_rounds` (`pending`, `ok`, `failed_paid`, `failed_free`) in the transactions that already settle
  it (`repository.ts:457-516`). Quota becomes a range count on one index, and the join to `jobs` is needed only for
  the few `pending` rows. Drop the early check when the insert follows in the same request.

### 10. A plan lives on the user and on the workspace, and is a boolean (M, with the first pack or custom deal)

- **Evidence.** A workspace is Pro through its subscription or because any of its owners has `user.plan = 'pro'`
  (`packages/core/src/billing/service.ts:167-184`, `:178`), so a comped user made co-owner elsewhere upgrades that
  workspace too. `PlanId` is `free | pro` in the type (`packages/core/src/plans.ts:54`), the settings schema
  (`packages/core/src/settings.ts:54-55`), a database check (`packages/db/src/index.ts:191`) and `resolve(pro:
  boolean)` (`service.ts:150`). Scan packs, custom deals and a storage cap are all on the roadmap
  (`docs/STATUS.md:336,363`) and each needs limits per workspace, not per plan.
- **What is right.** `workspacePlan` is the single read point (four call sites), and computing entitlement at read
  time handles period ends and grace without a cron. Keep both.
- **Recommendation.** When the first of those three is built, add one `workspace_grants` table (workspace, kind,
  limits, expires, reason, granted by), move the comp onto it, have `workspacePlan` merge grants over the plan's
  policy, and replace the `ocr_rounds.plan` check with validation in core. Do not materialize entitlement.

### 11. Delete and collapse (S each)

Boundaries were checked and hold: no AI SDK import outside `packages/ai`, no AWS SDK outside `packages/storage`,
`apps/web` imports `packages/db` only for the auth adapter and two reads. They hold by convention; nothing in
`eslint.config.mjs` restricts imports. Add `no-restricted-imports` for those three rules.

- `PLAN.md`: describes pnpm, Clerk, BullMQ and synchronous OCR. None is true. Delete.
- `user_credentials` and `receipts.storage_source` (`packages/db/src/index.ts:100,380`): nothing reads or writes
  them (owner decision 8, `docs/STATUS.md:222`). Drop with the next migration; BYOK is not next.
- `receipt_status = 'uploaded'`: never written (inserts go straight to `processing`,
  `packages/core/src/repository.ts:426`), yet handled in seven places across four files and still the column default
  (`packages/db/src/index.ts:95`). Remove the handling; leave the enum value.
- `receipts.last_attempt_at`: written at `repository.ts:532`, read nowhere. Drop.
- Two upload modes with two response shapes (`apps/web/app/api/receipts/route.ts:90-155`): after finding 4, always
  answer 202 and poll. Open since the 2026-11-07 CTO review.
- Migrations live in `apps/web/drizzle` while the schema is in `packages/db`. Move them before `apps/worker` makes
  a second consumer; the deploy gate's path filter moves with them.
- `bunfig.toml:6`: remove the Better Auth cooldown exemption (due after today).

## Do not do

- **No BullMQ, Redis or service split.** One `apps/worker` calling `runWorkerLoop` is the whole next step.
- **No BYOK, MCP server, FX conversion or scan packs before the first paying workspaces.** `docs/plans` is 9,400
  lines; production had 9 receipts on 2026-11-09 (`docs/reviews/2026-11-09-database-review.md:300`).
- **No counter rows for quota** (finding 9 keeps one source of truth) and **no materialized entitlement** (finding 10).
- **No RLS policies or `app` role yet.** Scope-in-repository plus the integration tests is proportionate; do D2
  (turn the Data API off) instead.
- **No presigned direct-to-bucket uploads.** The 4 MB server path sniffs and validates the bytes and is one flow.
- **No second billing adapter and no further abstraction of the first.** `billing/provider.ts` is enough of a seam.
- **No more admin or telemetry surface.** Admin is about 10,000 lines with its tests, roughly a tenth of the
  TypeScript, and there are five telemetry destinations; none of them alerts anyone yet (finding 5).
- **No Effect rewrite and no squashing migrations again.**

## Keep

Round and attempt fencing on every write (`repository.ts:193-194`, `queue.ts:15-18`); the append-only ledger;
store-then-apply webhooks ordered by the provider's `updated_at` (`billing/service.ts:577`); a job row committed in
the same transaction as the thing it is for (`repository.ts:416-454`, `service.ts:382-400`); "missing configuration
turns a feature off, not the app"; the migrate-then-deploy gate.
