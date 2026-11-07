# Full database review, 2026-11-07

Scope: `main` at `2b5c57c`, read from code, migrations and docs only (no database was connected). Covers
`packages/db`, `apps/web/drizzle`, `packages/core` (jobs, ledger, quota, analytics, admin), the ops docs, PR #95's
`0002_two_factor_passkey_step_up` and the BYOK plan's proposed tables.

Sound and worth keeping: `timestamptz` everywhere; `numeric(12,2)` money and micro-USD cost summed as bigint; a
pooler-safe queue (one-statement `FOR UPDATE SKIP LOCKED` claim, transaction-scoped advisory locks only, `prepare:
false`, HOT heartbeats, `fillfactor 80`, `queue.ts:221-307`, `0000_baseline.sql:323-324`); a ledger that outlives
receipts; every receipt query narrowed by `organization_id` (`repository.ts:188-199`, `groups.ts:284-290`); and a
deploy gate that refuses code whose migrations production has not run (`production.yml:45-71`).

## Findings

### High

**H1. No backups, no restore drill.** The only backup is a manual step in a release checklist
(`docs/deployment.md:298-301`, "check PITR or take a backup"). `docs/production-environment.md` never says which
Supabase plan production is on; on Free there are no automatic backups and PITR is a paid add-on
(`docs/plans/2026-11-07-security-incident-readiness.md:349`). A bad migration, a mistaken `deleteWorkspace`
(`admin.ts:94`, cascades receipts and items) or an account compromise is unrecoverable today. Fix: a scheduled
`pg_dump --format=custom` GitHub workflow against `DIRECT_URL` to R2 (new `backup` environment), 14 daily copies, and
one timed restore into a scratch Supabase project written up in the runbook; or move to Pro and still do the drill.

**H2. Nothing is ever deleted.** `ocr_rounds`, `ocr_calls`, `jobs` (succeeded rows included), `admin_audit_log`,
`session` (expired rows, with `ip_address` and `user_agent`), `verification`, `rate_limit`, and from #95
`step_up_codes` and `step_up_events` (with `ip`) all grow without bound. The purge job is still "planned"
(`docs/plans/2026-11-06-jobs-queue.md:405`, `data-model.md` "Background jobs") and the ledger retention period is
owner decision 10 (`docs/STATUS.md:131`). Fix: one `maintenance.purge` job kind (priority 9, batched `DELETE ...
WHERE ctid IN (SELECT ... LIMIT 5000)`), run from the daily cron: `jobs` succeeded after 7 d, dead/cancelled after
30 d; `session` past `expires_at`; `verification` and `step_up_codes` past `expires_at`; `step_up_events` after 90 d;
`rate_limit` idle 1 d; ledger rows after 13 months once the owner confirms. Add `jobs (finished_at) where state in
('succeeded','dead','cancelled')` if `jobs_state_finished_idx` does not carry it, and a privacy-page line.

**H3. `receipts.receipt_date` is free text.** `packages/db/src/index.ts:74`. The model may return any 32-character
string (`packages/ai/src/schema.ts`); History's date filters compare text lexicographically
(`repository.ts:217-218`), analytics guards every row with a regex `CASE` (`analytics/spend.ts:117-124`), and there is
no index, so a date range scans the whole workspace. Fix: land PR 2 of the dual-calendar plan now, before rows
accumulate: `receipt_date date`, `receipt_date_check` with its `CHECK`, index `(organization_id, receipt_date)`,
and the add-column, backfill, swap sequence in `docs/plans/2026-11-07-dual-calendar-dates.md:254-283`.

**H4. RLS posture is right as defence in depth, but unverified and tied to the most privileged role.** The app and
migrations both run as `postgres`, the table owner (`docs/architecture/db.md`, "Row-level security"). Supabase's
default privileges still grant `anon` and `authenticated` DML on new `public` tables; RLS with no policies hides rows,
but the PostgREST OpenAPI root still lists table and column names to anyone with the anon key, and `service_role`
bypasses RLS. Removing `public` from the Data API's exposed schemas is an owner to-do (`docs/STATUS.md:46-49`), not
something a test checks. Fix: (a) a migration guarded by `IF EXISTS (select 1 from pg_roles where rolname = 'anon')`
that `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` and `ALTER DEFAULT PRIVILEGES FOR ROLE
postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`; (b) extend `rls.int.test.ts:497-519` to
assert no grants to those roles when they exist; (c) record in `production-environment.md` that the Data API is
disabled, with the check query. Later: a dedicated `app` role with DML only and permissive policies `USING (true)`
for it, since Supabase's `postgres` cannot grant `BYPASSRLS`.

### Medium

**M1. Widening a CHECK locks and scans the table.** `0001_ocr_call_refused_unsupported.sql:1` drops and re-adds
`ocr_calls_status_check`: `ADD CONSTRAINT ... CHECK` takes `ACCESS EXCLUSIVE` and scans every row. Each new failure
kind repeats it on the fastest-growing table, inside drizzle-kit's single transaction, with no `lock_timeout`. Fix:
`ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT` (`SHARE UPDATE EXCLUSIVE`), or replace the list with an
`ocr_call_status` lookup table; add `SET lock_timeout = '5s'` as the first statement of every hand-edited migration
and say so in `db.md`, "Add a migration". Keep the runbook's `CREATE INDEX CONCURRENTLY` rule (`runbook.md:157`).

**M2. Foreign keys without an index on the referencing column.** `ocr_rounds.organization_id` (`index.ts:143`),
`ocr_calls.user_id` (`:192`), `jobs.user_id` (`:277`, only the partial `jobs_running_idx` exists, `:303-305`),
`invitation.inviter_id` (`auth-schema.ts:159`), `receipt_groups.created_by`, `receipt_group_members.added_by`,
`admin_audit_log.actor_id`. Deleting a workspace or account runs `SET NULL`/cascade checks as sequential scans of the
ledger and the jobs table, holding row locks on `user`/`organization` meanwhile. Fix: add the five indexes that matter
(`ocr_rounds (organization_id)`, `ocr_calls (user_id)`, `jobs (user_id)`, `invitation (inviter_id)`,
`admin_audit_log (actor_id)`) in one migration; CONCURRENTLY by hand if the tables are already large.

**M3. Connection budget is undocumented and per-bundle.** Pool max 5 per process (`index.ts:487-499`), but the upload
and retry routes keep a function alive for up to 290 s running jobs in `after()` (`apps/web/lib/jobs.ts:19`,
`api/receipts/route.ts:32,82`), so concurrent uploads multiply warm instances, each with its own pool; the load test
already saw 10 connections against a max of 5 (`STATUS.md:252`), which points at two module instances of
`packages/db` in one process. No `max_lifetime`, `statement_timeout` or `idle_in_transaction_session_timeout` is set.
Fix: cache the pool on `globalThis` keyed by URL; `max_lifetime: 1800`; `ALTER ROLE postgres SET
idle_in_transaction_session_timeout = '30s'` and `statement_timeout = '60s'` (migrations override per session);
write the arithmetic (instances x 5 against Supavisor's client limit for the compute size) in
`production-environment.md`.

**M4. The quota count is the top statement under load.** `usage.ts:74-75,117-120` runs four correlated subqueries
over `ocr_rounds`/`ocr_calls`/`jobs` per user, twice per upload, under the user's advisory lock (`usage.ts:102`).
Index coverage is fine; the cost is the shape. Fix: measure with `EXPLAIN (ANALYZE, BUFFERS)` on the compose stack
first; the cheap win is a `(user_id, created_at) INCLUDE (receipt_id, round)` index on `ocr_rounds` so the outer scan
is index-only; the structural one is a per-user daily counter row maintained in the same transaction.

**M5. PR #95 schema.** `0002_two_factor_passkey_step_up.sql`: expand-only and correct (`NOT NULL DEFAULT false` on
`user` is metadata-only; cascades right; unique `credential_id` and `two_factor.user_id`). Gaps: `passkey.created_at`
is nullable; `step_up_events.ip` and `step_up_codes` have no retention (H2) and no `expires_at` index for the purge;
`two_factor.secret` and `backup_codes` are sealed with `BETTER_AUTH_SECRET`, so the "Rotating the auth secret" steps
in `deployment.md` must say that rotation without re-encryption locks every 2FA user out. Fix in the PR: `NOT NULL
DEFAULT now()`, an index on `step_up_codes (expires_at)`, and the runbook line.

**M6. Missing checks and loose columns.** `receipts.attempts` has no `BETWEEN 1 AND 3` (`index.ts:91`;
`MAX_EXTRACTION_ATTEMPTS` lives only in code); `receipts.currency` is free text defaulting to `'USD'` and analytics
normalise it per row (`spend.ts:172`); `storage_source`, `user_credentials.status`, `receipt_items.quantity` and
`member.role` take any value. Fix: `CHECK (attempts between 1 and 3)`, `CHECK (currency ~ '^[A-Z]{3}$')` after
normalising on write, `quantity >= 0`; drop `user_credentials` and `storage_source` in the BYOK contract migration
(decision 9).

### Low

**L1. Unused and redundant indexes.** `receipts_last_attempt_at_idx` (`index.ts:107`) has no query since the ledger
replaced the receipt-based quota; `member_organization_id_idx` is a prefix of `member_org_user_idx`
(`auth-schema.ts:140,143`). Drop both; fix the "Other indexes" table in `data-model.md`.

**L2. Search has no index.** `ilike` on `merchant`/`file_name` (`repository.ts:203`) and audit columns
(`admin-queries.ts:542-545`) scan; add `pg_trgm` GIN on `receipts (merchant)` past ~50k receipts per workspace.

**L3. Admin scans.** Active-users buckets read `session` by `created_at`/`updated_at` unindexed
(`admin-ops.ts:450-462`); job search by `receipt_id` (`admin-ops.ts:695`) has only the partial live index. Add
`session (updated_at)` and `jobs (receipt_id)` when those pages slow down.

**L4. Lock ordering.** `rerunJob` locks the job row then the receipt (`jobs/admin.ts:58-87`); `claimRetry` updates
the receipt then the jobs (`repository.ts:487-535`). A simultaneous admin re-run and user retry of one receipt can
deadlock; Postgres aborts one, so this is a retry-the-request problem, not corruption. Lock the receipt first in both.

**L5. BYOK plan tables** (`docs/plans/2026-11-07-byok.md:253-347`): sound shape (sealed text + `kek_version`,
`status` with `removed` kept for audit). Add before implementing: `ON DELETE CASCADE` from `organization` so a
deleted workspace takes its key material with it, a unique `(organization_id, provider, position)`, an index on
`kek_version` for the re-wrap counts, and the `key_source` columns on `ocr_rounds`/`ocr_calls` as nullable with no
backfill.

**L6. Docs drift.** `data-model.md` still credits the receipt quota indexes; `production-environment.md` has no
database section (plan, compute size, pooler limits, backups).

## Action list

1. Nightly `pg_dump` workflow to R2 plus one timed restore drill, documented in the runbook (H1).
2. `maintenance.purge` job kind on the daily cron, with the retention table above and a privacy-page line (H2).
3. Land dual-calendar PR 2: `receipt_date date`, `receipt_date_check`, `(organization_id, receipt_date)` index (H3).
4. Guarded `REVOKE` migration for `anon`/`authenticated`, grant assertion in `rls.int.test.ts`, confirm the Data API
   is off (H4).
5. Index migration for the unindexed FK columns (M2) and drop `receipts_last_attempt_at_idx`,
   `member_organization_id_idx` (L1).
6. Pool on `globalThis`, `max_lifetime`, role-level `statement_timeout` and `idle_in_transaction_session_timeout`;
   connection arithmetic in `production-environment.md` (M3).
7. Migration conventions in `db.md`: `lock_timeout` first, `NOT VALID` + `VALIDATE` for checks, lookup table for
   `ocr_calls.status` (M1).
8. Profile the quota statement on the compose stack and add the covering `ocr_rounds` index if it pays (M4).
9. PR #95 fixes before merge: `passkey.created_at NOT NULL`, `step_up_codes (expires_at)` index, auth-secret
   rotation note (M5).
10. Check constraints on `receipts.attempts`, `currency`, `receipt_items.quantity`; schedule the BYOK contract
    migration that drops `user_credentials` (M6, L5).
