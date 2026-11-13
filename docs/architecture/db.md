# packages/db

The Drizzle ORM schema for every table, and the one connection pool each process uses. The tables themselves, with
their keys and delete behaviour, are on the [data model](data-model.md) page.

## Contents

- [Public API](#public-api)
- [Key modules](#key-modules)
- [Migrations](#migrations)
- [Design principles and invariants](#design-principles-and-invariants)
- [How to test it](#how-to-test-it)
- [Common changes](#common-changes)

## Public API

From `@receipt-ocr/db` ([`src/index.ts`](../../packages/db/src/index.ts)):

| Export                                                                                                 | What                                                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `createDb(url)`, `DbClient`                                                                            | The cached Drizzle client for a connection string                                 |
| `receipts`, `receiptItems`, `ocrRounds`, `ocrCalls`, `adminAuditLog`, `appSettings`, `userCredentials` | App tables                                                                        |
| `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `rateLimit`      | Better Auth tables ([`auth-schema.ts`](../../packages/db/src/auth-schema.ts))     |
| `schema`                                                                                               | All tables and relations, passed to Drizzle and to Better Auth's adapter          |
| `OCR_CALL_STATUSES`                                                                                    | Allowed `ocr_calls.status` values, also used to build the `CHECK` constraint      |
| `MAX_EXTRACTION_ATTEMPTS`                                                                              | The retry cap (3), used by core and by `receipts_attempts_check`                  |
| `and`, `eq`, `sql`, `desc`, `inArray`, ...                                                             | Drizzle operators, re-exported so every package uses this package's `drizzle-orm` |
| `Receipt`, `ReceiptItem`, `OcrCall`, `NewOcrCall`, `AdminAuditEntry`, ...                              | Row types inferred from the tables                                                |

## Key modules

| File                                                             | What it holds                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`src/index.ts`](../../packages/db/src/index.ts)                 | App tables, relations, `createDb` and the pool settings                       |
| [`src/auth-schema.ts`](../../packages/db/src/auth-schema.ts)     | Better Auth core, organization and admin plugin tables, in this repo's naming |
| [`apps/web/drizzle.config.ts`](../../apps/web/drizzle.config.ts) | drizzle-kit config: schema from this package, SQL out to `apps/web/drizzle`   |
| [`apps/web/drizzle/`](../../apps/web/drizzle)                    | Generated SQL migrations and their snapshots                                  |

## Migrations

| File                                                                              | What it holds                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`0000_baseline.sql`](../../apps/web/drizzle/0000_baseline.sql)                   | Every table, enum, index, `CHECK` and foreign key, `ENABLE ROW LEVEL SECURITY` on all 23 tables; hand-written: `lock_timeout` first and the `jobs` storage parameters last     |
| [`0001_billing.sql`](../../apps/web/drizzle/0001_billing.sql)                     | `billing_events` and `billing_subscriptions`, `ocr_rounds.plan`, and `ocr_rounds_org_created_at_idx` in place of `ocr_rounds_organization_id_idx`                              |
| [`0002_receipt_review.sql`](../../apps/web/drizzle/0002_receipt_review.sql)       | `receipts.reviewed_at`, `reviewed_by` (foreign key to `user`, set null) and the partial `receipts_reviewed_by_idx`; `lock_timeout` first                                       |
| [`0004_billing_checkouts.sql`](../../apps/web/drizzle/0004_billing_checkouts.sql) | `billing_checkouts` (foreign keys to `organization` and `user`, cascade); validates the six 0003 `CHECK`s and repeats the 0003 `low_confidence` backfill; `lock_timeout` first |

The migrations were **squashed into this one baseline again on 2026-11-08, before launch**, when both databases held
only test data and were reset. The first squash (2026-11-07) was followed by three migrations: the `refused` and
`unsupported-file` OCR statuses, two-step sign-in and passkeys, and the database review's schema fixes. Folded in, the
launch schema is one file of `CREATE` statements instead of creates followed by alters, a `receipt_date` text-to-date
cast and a `currency` clean-up written for rows that no database has. All but two statements are generated by
drizzle-kit from the schema, so `bun run db:generate` reports no changes. The old four files and the new baseline,
each applied to a fresh Postgres 17 and 18 database, give the same `pg_dump --schema-only` except column order in
`session` and `user`: the old files appended the two-step columns with `ALTER TABLE ... ADD COLUMN`, and the baseline
follows the schema's order.

**From the first real user onward migrations are never squashed again:** each change is a new `NNNN_<name>.sql` file
from `bun run db:generate`.

`drizzle-kit migrate` records applied files in `drizzle.__drizzle_migrations`, so rerunning it only applies new ones.
It uses `DIRECT_URL` when set, otherwise `DATABASE_URL`.

## Design principles and invariants

- **Postgres versions: Supabase runs 17; self-hosted Docker uses 18; CI tests migrations and integration on both.**
  CI's integration job runs on both majors and the e2e jobs on 17, so a migration or query that only works on one
  major fails the PR. Supabase reported `show server_version` = 17.11 on both projects (2026-11-08). CI pins
  `postgres:17.10-alpine`; bump 17.10 to 17.11 after 2026-11-13, when it clears the 7-day cooldown.
- **Driver: node-postgres (`pg`) with `drizzle-orm/node-postgres`.** The same code runs against direct Postgres
  (Docker, RDS), PgBouncer, Supabase's Supavisor and Neon's pooler. pg-pool checks out one connection per query and
  never pipelines onto a busy one, which is what a transaction-mode pooler needs (postgres.js did pipeline, which
  caused the [2026-11-09 Home incident](../reviews/2026-11-09-home-stuck-incident.md)). Drizzle sends unnamed
  statements, so no prepared-statement setting is needed for poolers. Nothing in the app is provider-specific;
  migrations need DDL and use a session connection through `DIRECT_URL`.
- **TLS: `DATABASE_SSL_CA` decides.** With the server's CA certificate (PEM) in `DATABASE_SSL_CA`, `tlsOptions` connects
  over TLS verified against it and drops the URL's `sslmode`, which pg would otherwise let override `ssl`. Without it,
  the URL decides as pg reads it: no `sslmode` is a plain connection (local Docker), and `require` means verify-full
  against Node's public CAs, which fails for a server whose CA isn't public. Supabase signs with its own "Supabase Root
  2021 CA" ([download](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt), SHA-256
  `80:70:25:AD:…:E6:CA:FA`, valid to 2031-04-26), so staging and production set it (Infisical and Vercel, 2026-11-09). Migrations
  (drizzle-kit, also pg) read the same variable in `drizzle.config.ts`; the Database Migration workflow gets it from the
  `staging-db` and `production-db` environments' variables.
  postgres.js read `require` as encrypt-without-verify, which is why the switch to pg broke production for about 15 minutes
  until it was rolled back.
- **One pool per connection string per process.** `createDb` caches it on `globalThis` (Next can load the module more
  than once). Better Auth, the admin pages and the Effect runtime share it. `DATABASE_POOL_MAX` (default 10). Behind a
  pooler each connection is one of its clients: Supavisor on Nano/Micro allows 200, so instances × 10 must stay under 200. Direct Postgres counts them against `max_connections` instead.
- **Timeouts are pg's own, set in `createPool`.**
  - `query_timeout` (`DATABASE_QUERY_TIMEOUT_MS`, 15 s): the client stops waiting for a reply. This catches what the
    server can't, a dead socket or a lost reply. The query rejects with `Query read timeout`, logged as
    `error.code = query_timeout`. A valid statement slower than this (a lock wait) fails too, and a timed-out write may
    still have committed.
  - `connectionTimeoutMillis` (10 s): bounds connecting and the wait for a free client (`connect_timeout`).
  - `idleTimeoutMillis` (20 s), `keepAlive`, `allowExitOnIdle`.
  - A timed-out client is never reused. `pool.query` releases it with the error, so the pool drops it. drizzle's
    `transaction()` releases without the error, so `TimeoutClosingClient` (in `createPool`) closes a client whose
    query timed out. Otherwise it could go back to the pool with its statement, and maybe its transaction, still
    open. It also fails the statements after that (drizzle's ROLLBACK) with the same timeout, so a transaction reports
    `query_timeout` too, not "Client was closed".
  - Connection errors never crash the process. `TimeoutClosingClient` keeps an `error` listener on every client for its
    whole life: pg-pool removes its own while a client is checked out, and drizzle's `transaction()` adds none, so a
    session the server ends mid-transaction (`idle_in_transaction_session_timeout`, a restart) would otherwise be an
    uncaught exception. The transaction's next statement fails instead (`connection_lost`). An idle client that dies
    reaches `pool.on("error")`, which core logs as `db.pool_error` once its Db layer is built. A process that has only
    built the auth pool logs nothing for it (follow-up).
- **Server-side timeouts are role settings, not client options** (applied on staging and production 2026-11-09). pg
  would send `statement_timeout` as a startup parameter: PgBouncer rejects unknown startup parameters and Supavisor
  ignores them. Role settings are plain Postgres and work the same everywhere: `statement_timeout = '10s'` (below the
  client's 15 s, so the server ends a long statement and its transaction rolls back cleanly before the client gives
  up) and `idle_in_transaction_session_timeout = '15s'` (ends a transaction its client abandoned).
  - Set:

    ```sql
    ALTER ROLE postgres SET statement_timeout = '10s';
    ALTER ROLE postgres SET idle_in_transaction_session_timeout = '15s';
    ```

    A new deployment runs the same on its app role as a setup step ([deployment](../deployment.md#1-database)), not
    in a migration: on a self-hosted setup migrations may run as a different role than the app. New sessions pick it
    up; behind Supavisor, its backends recycle within minutes.

  - Check: `select rolconfig from pg_roles where rolname = 'postgres'`.
  - Undo:

    ```sql
    ALTER ROLE postgres RESET statement_timeout;
    ALTER ROLE postgres RESET idle_in_transaction_session_timeout;
    ```

  - Effects: a query run by hand as that role, including in Supabase's SQL editor, is capped at 10 s unless it runs
    `SET statement_timeout = 0` first. Migrations run as `postgres` too: a statement that may take longer (an index
    build, a backfill) starts with `SET LOCAL statement_timeout = '…'` next to its `SET LOCAL lock_timeout`.
  - In the logs, SQLSTATE `57014` is the statement timeout and `25P03` the idle-in-transaction one.
- **Optional on Vercel:** `@vercel/functions`' `attachDatabasePool(pool)` keeps a Fluid instance alive until idle
  clients close. It isn't used; the timeouts above bound what a suspended socket can cost.
- **Tests:** `src/pg.int.test.ts` runs the pool through a TCP proxy that models a transaction-mode pooler's backend
  release and a dead socket (CI's integration job runs it). A CI job against a real PgBouncer in transaction mode is
  a possible follow-up.
- **One `drizzle-orm` instance.** Consumers import operators from `@receipt-ocr/db`, not `drizzle-orm`, to avoid
  duplicate-instance type errors.
- **The ledger has no foreign key to receipts.** `ocr_rounds.receipt_id` and `ocr_calls.receipt_id` outlive the
  receipt. Their workspace and user columns are `SET NULL`.
- **Auth tables follow Better Auth's model.** Field names (for example `rate_limit.key`, `count`, `last_request`)
  must match what the Drizzle adapter expects. Columns are snake_case, timestamps are `timestamptz`.
- **Row-level security is on for every table, with no policies.** Each `pgTable(...)` ends in `.enableRLS()`. The app
  connects as `postgres`, which owns the tables, so nothing changes for it (on Supabase it also has `BYPASSRLS`). The
  point is defence in depth: Supabase's Data API (PostgREST) exposes the `public` schema as `anon` and
  `authenticated`, and with RLS on and no policy they read and write no rows even if someone later grants them access.
  `service_role` bypasses RLS by design, so only removing `public` from the Data API's exposed schemas protects
  against a leaked service-role key. Do not add `FORCE ROW LEVEL SECURITY` (it would apply RLS to the owner the app
  uses) and do not add policies unless the app starts using the Data API. `rls.test.ts` fails when a table lacks
  `.enableRLS()`, and `rls.int.test.ts` checks the migrated database, including that the app role owns every table.
- **`user_credentials` and `receipts.storage_source` are unused.** Reserved for bring-your-own-key; nothing reads or
  writes them, and no encryption exists for the ciphertext column (see [byok-key-management.md](../byok-key-management.md)
  and decision 8 in [STATUS](../STATUS.md)).

## How to test it

There are no unit tests in this package (the `.enableRLS()` guard lives in core); the schema is exercised by the integration suites in core and web
(`test:int`, against a real Postgres 17 and 18 in CI) and by the e2e jobs, which apply every migration to an empty
database first.

## Common changes

### Add a migration

1. Change the table in [`src/index.ts`](../../packages/db/src/index.ts) (or `auth-schema.ts` for auth tables).
2. Generate the SQL: `bun run db:generate`. This writes `apps/web/drizzle/NNNN_<name>.sql` and a snapshot.
3. Read the SQL. Rename the file to describe the change if drizzle-kit picked a random name, and keep the journal tag in
   step (or pass `--name`). New tables need `.enableRLS()`. When you edit the SQL by hand:
   - Make `SET LOCAL lock_timeout = '5s';` the first statement, so the migration gives up instead of queueing behind
     live traffic and blocking everything behind it. drizzle-kit runs all pending files in one transaction, so it
     covers them all.
   - A type change from text needs a `USING` cast; make it safe for every value the column can hold (`0003_schema_fixes.sql`
     in the history before the 2026-11-08 squash is the example).
   - On a table with rows, add a `CHECK` as `NOT VALID` in one migration and `VALIDATE CONSTRAINT` in the next: in the
     same transaction the scan still holds `ACCESS EXCLUSIVE`. Build indexes on large tables with
     `CREATE INDEX CONCURRENTLY` by hand ([runbook](../runbook.md)).
4. Apply it locally: `bun run db:migrate` (compose Postgres on port 5433).
5. Make it safe for the old code: the deploy order is migrate first, then deploy, so the running code must keep
   working against the new schema. Add columns as nullable or with a default; drop columns in a later release.
   After merging, run **Database Migration** on `staging-db`, then `production-db`, then deploy by hand
   ([deployment.md](../deployment.md#every-release)); the automatic deploy skips releases with migrations. The PR's
   preview runs against staging without it.
6. Add a release note to [deployment.md](../deployment.md#release-notes) and update the [data model](data-model.md).

### Add a Better Auth plugin that needs tables

Generate its schema with the Better Auth CLI, copy the tables into
[`auth-schema.ts`](../../packages/db/src/auth-schema.ts) in this repo's naming, add them to `schema`, then follow
the migration steps above. The [passkeys and 2FA plan](../plans/2026-11-06-passkeys-2fa.md) is an example
(**planned**; take the next free migration numbers when it lands).
