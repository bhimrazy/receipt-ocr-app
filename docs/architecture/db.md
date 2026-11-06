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

| File                                                                                                        | Adds                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`0000_better-auth.sql`](../../apps/web/drizzle/0000_better-auth.sql)                                       | Better Auth tables, first `receipts`, `receipt_items` and `user_credentials`               |
| [`0001_rate_limit.sql`](../../apps/web/drizzle/0001_rate_limit.sql)                                         | `rate_limit` (database-backed auth rate limits)                                            |
| [`0002_receipts_organization.sql`](../../apps/web/drizzle/0002_receipts_organization.sql)                   | `receipts.organization_id` with a backfill: receipts belong to a workspace                 |
| [`0003_receipts_file_name_and_indexes.sql`](../../apps/web/drizzle/0003_receipts_file_name_and_indexes.sql) | `file_name` and query indexes                                                              |
| [`0004_canonical_categories.sql`](../../apps/web/drizzle/0004_canonical_categories.sql)                     | Backfill of free-text categories to the canonical list                                     |
| [`0005_receipt_attempts.sql`](../../apps/web/drizzle/0005_receipt_attempts.sql)                             | `attempts`, `last_attempt_at` for capped retries                                           |
| [`0006_admin_audit_settings.sql`](../../apps/web/drizzle/0006_admin_audit_settings.sql)                     | `admin_audit_log`, `app_settings`, `receipts.model`; `receipts.user_id` becomes `SET NULL` |
| [`0007_ocr_usage_ledger.sql`](../../apps/web/drizzle/0007_ocr_usage_ledger.sql)                             | `ocr_rounds`, `ocr_calls` with their unique indexes and the status `CHECK`                 |
| [`0008_jobs_queue.sql`](../../apps/web/drizzle/0008_jobs_queue.sql)                                         | `jobs`, `job_controls`, `ocr_calls.job_attempt`; storage parameters and a backfill by hand |

`drizzle-kit migrate` records applied files in `drizzle.__drizzle_migrations`, so rerunning it only applies new ones.
It uses `DIRECT_URL` when set, otherwise `DATABASE_URL`.

## Design principles and invariants

- **One pool per connection string per process.** `createDb` caches the client. Better Auth, the admin pages and the
  Effect runtime all share it; a pool per caller would exhaust the Supabase pooler. The pool size is
  `DATABASE_POOL_MAX` (default 5).
- **`prepare: false`.** Supabase's transaction pooler (port 6543) doesn't support prepared statements, so the app
  connects through it with them off. Migrations need DDL and use the session pooler (port 5432) through `DIRECT_URL`.
- **One `drizzle-orm` instance.** Consumers import operators from `@receipt-ocr/db`, not `drizzle-orm`, to avoid
  duplicate-instance type errors.
- **The ledger has no foreign key to receipts.** `ocr_rounds.receipt_id` and `ocr_calls.receipt_id` outlive the
  receipt. Their workspace and user columns are `SET NULL`.
- **Auth tables follow Better Auth's model.** Field names (for example `rate_limit.key`, `count`, `last_request`)
  must match what the Drizzle adapter expects. Columns are snake_case, timestamps are `timestamptz`.
- **`user_credentials` and `receipts.storage_source` are unused.** Reserved for bring-your-own-key; nothing reads or
  writes them, and no encryption exists for the ciphertext column (see [byok-key-management.md](../byok-key-management.md)
  and decision 9 in [STATUS](../STATUS.md)).

## How to test it

There are no unit tests in this package; the schema is exercised by the integration suites in core and web
(`test:int`, against a real Postgres) and by the e2e job, which applies every migration to an empty database first.

## Common changes

### Add a migration

1. Change the table in [`src/index.ts`](../../packages/db/src/index.ts) (or `auth-schema.ts` for auth tables).
2. Generate the SQL: `bun run db:generate`. This writes `apps/web/drizzle/NNNN_<name>.sql` and a snapshot.
3. Read the SQL. Rename the file to describe the change if drizzle-kit picked a random name, and keep the journal in
   step.
4. Apply it locally: `bun run db:migrate` (compose Postgres on port 5433).
5. Make it safe for the old code: the deploy order is migrate first, then deploy, so the running code must keep
   working against the new schema. Add columns as nullable or with a default; drop columns in a later release.
6. Add a release note to [deployment.md](../deployment.md#release-notes) and update the [data model](data-model.md).

### Add a Better Auth plugin that needs tables

Generate its schema with the Better Auth CLI, copy the tables into
[`auth-schema.ts`](../../packages/db/src/auth-schema.ts) in this repo's naming, add them to `schema`, then follow
the migration steps above. The [passkeys and 2FA plan](../plans/2026-11-06-passkeys-2fa.md) is an example
(**planned**; take the next free migration numbers when it lands).
