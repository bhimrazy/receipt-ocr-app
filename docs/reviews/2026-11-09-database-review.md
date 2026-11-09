# Database review, 2026-11-09

Scope: `main` at `65e19cc`. Covers `packages/db`, `apps/web/drizzle`, the queries in `packages/core` and `apps/web/lib`, the
connection setup, and production's live state. It follows the [2026-11-07 database review](2026-11-07-full-database.md).
The incident fix for hanging Home sections (in-process query gate, client deadline, pool max 10, error boundaries, cached
plan and checkout reads) is being built separately. This review comments on it but doesn't repeat it.

## How it was measured

- **Production** (Postgres 17.11): read-only Management API SQL as
  `supabase_read_only_user`, plus GET calls for the PostgREST, pooler and backup config. Nothing was written. Production
  holds test data only (9 receipts, 13 MB), so its index-usage counts say nothing about scale.
- **Local volume**: the baseline and `0001_billing` migrations applied to a new database, seeded with 300 workspaces of
  150 receipts plus two of 10,000. That is 55,000 receipts, 216,000 items, 59,303 `ocr_calls`, 60,500 `jobs`, 20,000
  `session` and 5,000 `rate_limit` rows. EXPLAINs ran on a copy in a Postgres 17.11 container (prod's major version), after
  `VACUUM ANALYZE`.
- **Timings are noisy.** The codespace has 2 vCPUs and a load average of about 11 from other sessions, so read the buffer
  counts as the stable figure and the milliseconds as upper bounds.
- **Statements per render**: Home was measured once with `log_statement = all` against the 10k workspace. History, the
  receipt page and `/admin` are counted by tracing the code. The dev server was killed (SIGTERM) before those pages could
  be measured, and there was then a memory freeze on the box.

## TL;DR

The schema is in good shape. Most of the 2026-11-07 review landed:
- `receipt_date` is a `date` with a plausibility CHECK and a `(organization_id, receipt_date)` index. On prod,
  `information_schema` reports `date`.
- The foreign-key indexes and the CHECKs were added, and the redundant indexes were dropped.

What remains is operational:
1. Production has **no backups**: 0 backups, PITR off, and the backup PR #131 has been open since 2026-11-08.
2. There are **no server-side timeouts**. The `postgres` role has no `statement_timeout`, and
   `idle_in_transaction_session_timeout` is 0.
3. The **Data API still exposes `public`**, with `anon` and `authenticated` holding table grants. RLS without policies
   blocks row access.
4. **Nothing is ever purged.**

On performance, every `/app` render sends 15–17 statements. About 8 of them go out in one `Promise.all` at
`layout.tsx:103`, more than the pool's 5 connections. That is what turned porsager/postgres#970 into a hang. Removing the
redundant reads in that layout is the cheapest structural fix after the incident PR.

At 10k receipts per workspace, the per-render costs are:
- the spend dashboard: 175–290 ms;
- the counts aggregate: 70–250 ms;
- the quota statement, which holds the user's advisory lock: 36–187 ms. It hash-scans every successful `ocr_calls` row on
  the platform.

## Findings, by severity

### High

**H1. No backups exist.** `GET /v1/projects/{ref}/database/backups` returned
`{"pitr_enabled":false,"walg_enabled":true,"n":0}`, and no compute add-on is selected (`billing/addons` is `[]`). PR #131
(nightly encrypted `pg_dump` to R2 with a restore drill) has been open and unmerged since 2026-11-08.
- Impact: a bad migration, a mistaken workspace delete (it cascades receipts and items) or a compromise can't be undone.
  This must be fixed before the first real user.
- Fix: review and merge #131, run the restore drill once, and record its time in the runbook. Effort S (the PR exists).
  Then see decision D1.

**H2. The database enforces no timeouts.** Prod `pg_roles.rolconfig` for `postgres` holds only `search_path`.
`idle_in_transaction_session_timeout = 0` and `lock_timeout = 0`. The 120 s `statement_timeout` shown is the read-only
role's. The app sets none either (`packages/db/src/index.ts:688-694`). `pg_stat_database` shows 36.6 s of
idle-in-transaction time and 303 abandoned sessions since 2026-11-03.
- Impact: the incident PR's client deadline gives up on a query, but the server keeps running it. A transaction cut off
  mid-flight can sit idle while holding `pg_advisory_xact_lock(7301, user)` (`usage.ts:149-158`). Every later upload or
  retry by that user then waits behind it until Supavisor or the backend drops the connection.
- Fix: set `statement_timeout` and `idle_in_transaction_session_timeout` on the app's role (see D4). As a role setting it
  applies on every Supavisor server connection. Migrations override it per session (`SET statement_timeout = 0`). Effort S.

**H3. Every `/app` render fans out more statements than the pool has connections.**
- The layout's `Promise.all` (`apps/web/app/app/layout.tsx:103-107`) issues up to 8 reads at once. The pool max is 5
  (`index.ts:682`).
- Measured Home render: 17 statements. By trace: History 15, receipt page 15, `/admin` 9–10.
- Redundant work on every navigation:
  - `member` is read four times, by `workspace.ts:14`, `workspaces.ts:29`, `:48` and `:59`. One membership list gives the
    scope, the owned count and the switcher.
  - The plan is resolved twice: `accountPlan` (`billing/service.ts:187`) and `workspacePlan` (`:167`).
  - Passkeys are counted twice, by `account-security.ts:119` and `:143`, and both re-read `user`, which Better Auth has
    already loaded.
  - On Home, the list's `count(*)` (`repository.ts:624`) is computed and thrown away. `RecentSection` uses only `rows`,
    and `counts.total` already holds it.
- Impact: this fan-out is why one render could exhaust the pool and hit #970's pipelining path. It also costs about 15
  round trips of Vercel-to-Supavisor latency per navigation.
- Fix:
  - Fold the four member reads into one, and the two plan reads into one statement.
  - Read passkey state once per request with `cache()`.
  - Add a `withTotal: false` option to `list()` for Home.
  - That takes the layout from about 12 statements to about 6. Effort M.

### Medium

**M1. The Data API exposes `public`, and `anon` holds grants.** PostgREST's `db_schema` is `public,graphql_public`.
`has_table_privilege('anon', …, 'SELECT')` and `('authenticated', …, 'INSERT')` are true on all 25 tables. All 25 have RLS
enabled with 0 policies, so no rows are readable today. But anyone with the public anon key can list the table and column
names through the OpenAPI root, and one future `CREATE POLICY` mistake would expose real data. This was 2026-11-07 review
H4, and it is still an owner to-do in `STATUS.md`.
- Fix:
  - Remove `public` from the exposed schemas (D2).
  - Add a guarded migration that runs `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` and
    `ALTER DEFAULT PRIVILEGES ... REVOKE`.
  - Assert the absence of those grants in `rls.int.test.ts`.
- Effort S.

**M2. Nothing is purged.**
- There is no maintenance job kind: `jobs/kinds/` holds `billing-apply`, `contact-reply`, `receipt-extract` and
  `welcome-email`.
- Expired `session` rows (with `ip_address` and `user_agent`), `verification`, `rate_limit`, `step_up_codes`,
  `step_up_events.ip`, finished `jobs` and the ledger all grow without bound.
- In the seeded copy, the 60,500 `jobs` rows (98% succeeded) dominate the partial-index scans.
- Fix: one `maintenance.purge` kind on the existing 5-minute pg_cron drain, gated to run daily.
  - It deletes in batches of 5,000 using `jobs_state_finished_idx`, `session(expires_at)` and so on.
  - The retention periods are decision D3.
  - Add a line to the privacy page.
- Effort M.

**M3. Home and History scan the whole workspace on every render.** All figures are for 10,000 receipts on PG 17.

| Query                                                                 | Plan                                                         | Buffers | Time         |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ------- | ------------ |
| counts aggregate (`repository.ts:637-645`), Home and History           | Bitmap heap scan of 10,000 rows plus 208 `jobs` probes       | 1,743   | 68–250 ms    |
| spend dashboard (`analytics/spend.ts`, 7 grouping sets), Home          | Bitmap scan of 9,008 rows, sort, GroupAggregate, WindowAgg   | —       | 175–290 ms   |
| list total `count(*)`                                                 | Index-only scan                                              | 13      | 3 ms         |
| History page 1 (`LIMIT 25 OFFSET 0`)                                  | Backward index scan on `receipts_org_created_at_idx`         | 43      | 0.8 ms       |
| History page 200 (`OFFSET 4975`)                                      | Bitmap scan of 10,000 rows, then a sort of all of them       | 1,433   | 39 ms        |
| search `q=star`: count                                                | Bitmap heap scan of 10,000 rows, then a filter               | 495     | 45 ms        |
| status=failed count                                                   | Bitmap heap scan plus `jobs` probes                          | 1,336   | 17 ms        |
| receipt detail (`findFirst` with items)                               | Primary-key lookup plus an items subquery                    | 11      | under 1 ms   |

- Impact: Home costs about 300–500 ms of database time per render at 10k receipts, and it grows linearly. OFFSET and
  search are acceptable up to about 50k receipts per workspace.
- Fix, in order:
  1. Cache `getReceiptCounts` and the spend view per workspace for 30–60 s. Bust the cache on upload, complete, delete and
     edit. Effort M.
  2. Drop the discarded count (H3).
  3. Later: keyset pagination for History, and a `pg_trgm` GIN index on `merchant` past about 50k receipts per workspace.

**M4. The quota statement scans the platform-wide ledger while it holds the user's lock.**
- `countUsage` (`usage.ts:107-139`) runs under `pg_advisory_xact_lock` on every upload and retry. The layout runs it
  again on every render, through `getUsageSummary`.
- On PG 17 it takes 36–187 ms and touches 3,828 buffers for a user with 276 rounds this month.
- The planner turns `readOk` inside the `or` into a **hashed SubPlan that seq-scans every `ok` call on the platform**
  (`Seq Scan on ocr_calls c … rows=52221`) instead of 276 index probes. Wrapping the predicate in `CASE` gives the same
  plan: the planner chooses the hashed alternative on cost.
- Impact: upload latency, and the time the lock is held, grow with total platform usage, not with the user's own usage.
  The planner should switch to per-row probes once the hash outgrows `work_mem`, but that is not verified.
- Fix: measure again at 1M calls before changing anything. The structural fix is a per-subject daily and monthly counter
  row, updated in the same transaction (decision D5, later). Effort L.

**M5. The pool cache is per module copy, not per process.**
- `const pools = new Map()` sits at `index.ts:679`.
- Elsewhere the codebase puts its singletons on `globalThis` for exactly this reason: instrumentation and the app bundle
  load separate module copies (`telemetry/logger.ts:85-89`, `lib/log.ts:24-28`, `lib/telemetry/errors.ts:18-19`).
- The 2026-11-06 load test saw 10 connections against a max of 5.
- Impact: Supavisor sees `max × copies` client connections from each instance. More importantly, **the incident PR's
  in-process gate will be per copy too** unless it shares the same anchor.
- Fix: store the pool map (and the gate) on `globalThis.__receiptOcrDb`. Effort S. Comment for the incident PR.

**M6. Transactions and the incident gate.**
- Transactions are short and touch only the database. No transaction spans a call to R2, the AI provider or Paddle:
  - Stored files are purged after commit (`admin.ts:84-109`).
  - The Paddle cancel runs after `applyBillingEvent` returns (`billing/service.ts:455-520`).
  - The OCR job's database writes are single statements, fenced on `locked_by` and `attempts` (`jobs/queue.ts:240-288`).
- But `db.transaction` holds one connection for several statements (`repository.ts:415-453` makes 5 round trips).
- If the incident gate counts *statements*, a transaction's second statement waits for a gate slot while its first one
  still holds a connection. With 5 or more concurrent uploads, every slot can belong to such a transaction, and the
  process deadlocks.
- Fix (incident PR): gate on *reserved connections* (`sql.begin` takes one slot for the whole transaction), or let
  statements inside a transaction bypass the gate.
- When the deadline resets the pool, an in-flight `COMMIT` may still have landed:
  - `insert` uses a caller-supplied id, so a client retry fails on the primary key instead of double-charging.
  - `ocr_calls` already dedupes on its unique index (`index.ts:263-268`).
  - Keep it that way.

### Low

**L1. postgres.js fetches types on every new connection.** In prod `pg_stat_statements` since 2026-11-07,
`select b.oid, b.typarray from pg_catalog.pg_type …` ran **2,163 times and returned 834,332 rows**. That is one extra
round trip on every cold connection, and on Fluid with `idle_timeout: 20` connections are often cold.
- `fetch_types: false` would remove it, but array results would then come back as strings: the `groups` `text[]` in
  `exportRows` (`repository.ts:664-666`).
- Fix: test the export with `fetch_types: false` before switching. Effort S.

**L2. `0001_billing.sql` doesn't follow the lock-timeout rule.** `db.md:104` asks for `SET LOCAL lock_timeout = '5s'` first,
and only the baseline has it. `0001` also runs `DROP INDEX` and `ADD CONSTRAINT … CHECK` on `ocr_rounds` without
`CONCURRENTLY` or `NOT VALID`. That is harmless on today's tiny tables. Add a CI check that each new migration's first
statement sets `lock_timeout`. Effort S.

**L3. Lock order differs between two paths.** `rerunJob` locks the job, then the receipt (`jobs/admin.ts:57-87`).
`claimRetry` updates the receipt, then the jobs (`repository.ts:525-569`). Postgres aborts one side of a deadlock, so the
cost is a failed request, not corruption. Lock the receipt first in both. Effort S.

**L4. Two FK columns have no index.** `receipt_groups.created_by` and `receipt_group_members.added_by` are `SET NULL` on
user delete, so that delete scans both tables. Index them once groups are in real use. Effort S.

**L5. The admin overview scales with daily active users.** The six statements in `adminOverview`
(`admin-queries.ts:80-139`) run one after another. "Near-limit users" computes `usedSql` for every user with a round
today before its `LIMIT 50`. Run them with `Promise.all` once the gate exists, and cache the overview for 60 s. Effort S.

## Connections: assessment

- **Supavisor transaction mode (6543) with `prepare: false` is the right choice** for Fluid.
  - Session mode pins one server connection per client connection. With Fluid instances × pool 10 that runs out of
    Postgres's 60 `max_connections` (prod setting) quickly.
  - `prepare: false` costs a parse and plan per execution. Planning was 0.1–1 ms on these queries, which is acceptable.
- **Pool max 10** is fine against Supavisor's client limit as long as the gate (M5) is per process. Write the arithmetic
  into `production-environment.md`: instances × 10 client connections against the compute size's limit. Prod's pooler
  config reports `default_pool_size: null`, so Supabase's default for the compute size applies. The exact figure was not
  verified.
- **postgres.js `max_lifetime`** already defaults to 30–60 minutes in 3.x, so the 2026-11-07 review's M3 ask for it is moot.
- **postgres.js v4 or another driver**: there is no evidence it is worth it. #970 is a pipelining interaction with
  transaction-mode poolers. Capping in-flight queries at the pool size, as the incident PR does, avoids the pipelining
  path altogether. Revisit only if the gate's metrics show waits building up.
- **Migrations**: drizzle-kit runs over `DIRECT_URL`, the session pooler on 5432 (`apps/web/drizzle.config.ts`). It runs
  all pending files in one transaction, so `SET LOCAL lock_timeout` in the first file covers them all. A file applied on
  its own needs its own (L2).

## Status of the 2026-11-07 review

| Item                                    | Status                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| H1 backups                              | **Open.** Prod has 0 backups and PITR off; #131 is unmerged                                              |
| H2 retention / purge                    | **Open.** No purge job kind                                                                              |
| H3 `receipt_date` as `date`             | Done: `index.ts:86`, `receipts_receipt_date_check`, `receipts_org_receipt_date_idx`; prod reports `date` |
| H4 RLS / grants / Data API              | Partly done. RLS is on for all 25 tables and tested; grants and Data API exposure remain (M1)            |
| M1 migration lock rules                 | Documented in `db.md:104`; `0001_billing` doesn't follow it (L2)                                         |
| M2 FK indexes                           | Done: `ocr_calls_user_id_idx`, `jobs_user_id_idx`, `invitation_inviter_id_idx`, `admin_audit_log_actor_id_idx`, `ocr_rounds_org_created_at_idx` |
| M3 pool and timeouts                    | **Open** (M5, H2)                                                                                        |
| M4 quota statement                      | Measured here (M4)                                                                                       |
| M5 passkey `created_at` NOT NULL        | Done (`auth-schema.ts:237`)                                                                              |
| M6 CHECKs                               | Done: attempts, currency, quantity (`index.ts:128-129,150`)                                              |
| L1 redundant indexes                    | Done: `member_organization_id_idx` and `receipts_last_attempt_at_idx` are gone                           |
| L2 trigram search                       | Deferred (M3)                                                                                            |
| L4 lock order                           | Open (L3)                                                                                                |

## What is good and should stay

- A one-statement `FOR UPDATE SKIP LOCKED` claim with per-owner fairness and fenced writes after the claim
  (`queue.ts:221-288`).
- Heartbeats as HOT updates. Prod shows `job_controls` at 1,412 updates, all 1,412 HOT. `jobs` uses `fillfactor 80`
  (`0000_baseline.sql`, last statement).
- Only transaction-scoped advisory locks, in separate two-key namespaces (7301, 7302). This is safe through Supavisor.
- Every receipt read and write is narrowed by `organization_id` (`repository.ts:196-204`). The ledger has no FK to
  receipts and survives deletes.
- Idempotency through unique indexes: `ocr_calls_receipt_round_attempt_step_idx`,
  `billing_events_provider_event_idx`, and the partial `jobs_idempotency_idx` and `jobs_receipt_live_idx`.
- Money as `numeric(12,2)`, cost as integer micro-USD, `timestamptz` everywhere, and a plausibility CHECK on dates.
- History page 1, the receipt page and the claim are all index-served at under 1 ms.
- The deploy gate refuses code whose migrations production hasn't run.

## Fix plan

**Already in the incident PR** (comments only):
- Gate on reserved connections, not statements, or let transaction statements bypass it (M6).
- Anchor the gate and the pool on `globalThis` (M5).
- Make the deadline's pool reset safe for in-flight `COMMIT`s. It is today; keep the primary-key and unique-index fences.
- Cross-request caching of the plan table and checkout config. The plan table already has a 30 s TTL in `settings.ts`, so
  its benefit is small.

**Next PRs**, in order:
1. Merge #131 and run the restore drill (H1). S.
2. Role-level `statement_timeout` and `idle_in_transaction_session_timeout` (H2, D4). S, owner-run.
3. Data API off, the `REVOKE` migration, and the grant assertion (M1, D2). S.
4. Slim the `/app` layout: one member read, one plan read, passkeys once, no discarded count (H3). M.
5. Cache counts and the spend view per workspace, with busting on writes (M3). M.
6. A `maintenance.purge` job kind (M2, D3). M.
7. Small items: the `lock_timeout` CI check, lock order, the `fetch_types` test, and running the admin overview in
   parallel (L1, L2, L3, L5). S each.

**Later, at scale**:
- Past about 50k receipts in one workspace: keyset pagination and a trigram search index.
- Past about 1M `ocr_calls`: re-measure the quota statement, then move to quota counter rows (M4, D5).
- With groups in real use: index `created_by` and `added_by` (L4).
- Past about 1M `jobs` rows: build indexes `CONCURRENTLY`, as `runbook.md:158` already says.

## Owner decisions

- **D1. Backups.** Choose between #131 (nightly `pg_dump` to R2; free; RPO 24 h) and Supabase Pro (daily backups plus an
  optional PITR add-on).
  - Recommendation: merge #131 now, and move to Pro at launch for managed backups. Keep #131 as an off-platform copy.
- **D2. Data API.** Turn it off (remove `public` from the exposed schemas) and revoke the `anon` and `authenticated`
  grants.
  - Recommendation: yes. The app never uses PostgREST: everything goes through Drizzle as `postgres`.
- **D3. Retention periods.**
  - Recommendation: `session` 7 days after expiry; `verification`, `step_up_codes` and `rate_limit` 1 day after they last
    apply; `jobs` 7 days once succeeded and 30 days once dead or cancelled; `step_up_events` 90 days; ledger 13 months;
    `billing_*` kept (financial record).
- **D4. Timeouts.** Set them on `postgres` now, or create a dedicated `app` role first. Note that Supabase's `postgres`
  can't grant BYPASSRLS, so an `app` role needs `USING (true)` policies.
  - Recommendation: `ALTER ROLE postgres SET statement_timeout = '30s'` and
    `SET idle_in_transaction_session_timeout = '15s'` now, run by the owner. Migrations set 0 per session. Move to an `app`
    role later.
- **D5. Quota at scale.** Keep counting from the ledger, or add counter rows.
  - Recommendation: keep the ledger until the 1M-call re-measurement says otherwise. Counter rows would duplicate the
    quota rules in a second place.

## Not verified

- Statement counts per render for History, the receipt page and `/admin`, apart from the one Home measurement.
- Timings on an idle machine.
- Prod plans at volume: prod has 9 receipts.
- Supavisor's actual pool size for this compute tier.
- Whether the planner drops the hashed SubPlan in M4 at larger ledger sizes.
- `fetch_types: false` with array results.
