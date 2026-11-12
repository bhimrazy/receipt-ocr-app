# packages/core

The backend workflow, written as [Effect](https://effect.website) services: receipt ingestion and extraction, the
model chain, quota, the usage ledger, billing, runtime settings, workspace resolution and admin writes. The web app runs these
programs; a future worker would run the same ones.

## Contents

- [Effect in two minutes](#effect-in-two-minutes)
- [Services and layers](#services-and-layers)
- [Public API](#public-api)
- [Key modules](#key-modules)
- [Data flow](#data-flow)
- [Design principles and invariants](#design-principles-and-invariants)
- [How to test it](#how-to-test-it)
- [Common changes](#common-changes)

## Effect in two minutes

If you have not used Effect: an `Effect<A, E, R>` is a description of work that succeeds with `A`, fails with a typed
error `E`, and needs services `R` to run. Nothing happens until a runtime runs it.

- **Services** are declared with `Context.Tag` (for example `ReceiptRepo`) and provided by a **Layer**
  (`ReceiptRepo.Live`).
- **Errors** are classes made with `Data.TaggedError`, so a caller can switch on `error._tag`.
- `Effect.gen(function* () { ... })` reads like async code: `yield*` an effect to get its value.

The web app builds one runtime from `AppLayer` ([`lib/runtime.ts`](../../apps/web/lib/runtime.ts)) and runs programs
with `runtime.runPromise` or `runPromiseExit`.

## Services and layers

```mermaid
flowchart TD
  app[AppLayer]
  repo[ReceiptRepo.Live]
  storage[Storage.Live]
  ocr[Ocr.Live]
  settings[Settings.Live<br/>30 s cache]
  db[Db.Live<br/>Drizzle pool]
  billing[Billing.Live<br/>Paddle webhooks, portal]

  app --> repo
  app --> billing
  billing -- needs --> db
  app --> storage
  app --> ocr
  repo -- needs --> db
  ocr -- "reads chain from" --> settings
  settings -- needs --> db
```

| Service                                                                        | Provides                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `Db` ([`services.ts`](../../packages/core/src/services.ts))                    | The Drizzle client and `use(query)`, which turns a rejected query into `DbError`                                                 |
| `Storage` ([`services.ts`](../../packages/core/src/services.ts))               | `put`, `get`, `remove`, `signedUrl` over [packages/storage](storage.md). Reads `S3_*` per call                                   |
| `ReceiptRepo` ([`repository.ts`](../../packages/core/src/repository.ts))       | Every receipt query and write, all scoped to a workspace                                                                         |
| `Ocr` ([`ocr.ts`](../../packages/core/src/ocr.ts))                             | `extract(file)` runs the chain; `ready` fails with `NotConfigured` when no model can run                                         |
| `Settings` ([`settings.ts`](../../packages/core/src/settings.ts))              | Plan limits and the OCR chain from `app_settings`, cached 30 s; `save` with audit                                                |
| `Billing` ([`billing/service.ts`](../../packages/core/src/billing/service.ts)) | `receiveWebhook` (verify, parse, store, enqueue) and `portalLinks`. Off (`NotConfigured`) unless every `PADDLE_*` setting is set |

`AppLayer` in [`index.ts`](../../packages/core/src/index.ts) wires them: `Settings` and `Db` are provided once and
shared, so there is one pool and one settings cache per process.

## Public API

Everything is exported from `@receipt-ocr/core`. Import-free entry points for client components:
`@receipt-ocr/core/plans` (plan defaults), `@receipt-ocr/core/upload-limits` (size and type limits) and
`@receipt-ocr/core/receipt-fields` (receipt date and currency bounds).

| Area        | Exports                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline    | `ingestUpload`, `runExtraction`, `settleFailure`, `claimRetry`, `deleteReceipts`, `deleteReceipt`, `purgeReceiptFiles`, `getReceiptWithImage`                                                 |
| Jobs        | `JobQueue`, `enqueueJob`, `tick`, `drainOnce`, `runWorkerLoop`, `cancelJob`, `JOB_REGISTRY`, `receiptExtract`, `backoffMs`, job errors                                                        |
| Billing     | `Billing`, `workspacePlan`, `accountPlan`, `workspaceCreationCheck`, `isEntitled`, `workspaceBilling`, `loadCheckoutConfig`, `applyBillingEvent`, `verifyPaddleSignature`, `parsePaddleEvent` |
| Quota       | `quotaLimits`, `checkQuota`, `enforceQuota`, `quotaGate`, `decideQuota`, `quotaMessage`                                                                                                       |
| Usage       | `countUsage`, `lockQuota`, `usageByDay`, `usageByModel`, `usageByWorkspace`, `receiptCalls`, `receiptsReadSince`                                                                              |
| Workspace   | `resolveScope`, `ensurePersonalWorkspace`, `hitRateLimit`, `parseWorkspaceName`, `personalWorkspaceName`                                                                                      |
| Admin       | `deleteWorkspace`, `prepareUserDeletion`, `setMemberRole`, `removeMember`, `cancelInvitation`, `setUserPlan`, `recordAudit`                                                                   |
| Admin reads | `adminOverview`, `listUsers`, `userDetail`, `listWorkspaces`, `workspaceDetail`, `listAudit`, `findUser`, `findWorkspace`                                                                     |
| Settings    | `Settings`, `providerAvailability`, `planTableSchema`, `ocrRoutingSchema`                                                                                                                     |
| Connections | `checkConnections`, `checkAiProviders`, `checkStorage`, `checkChainProviders`: on-demand status checks for Admin → Settings → Connections (statuses only, rate-limited, audited)              |
| Groups      | `listGroups`, `createGroup`, `updateGroup`, `deleteGroup`, `addReceiptsToGroup`, `removeReceiptsFromGroup`, `groupsOfReceipt`, `canManageGroup`, the schemas and limits in `group-rules.ts`   |
| Errors      | `InvalidInput`, `NotFound`, `Forbidden`, `Conflict`, `QuotaExceeded`, `NotConfigured`, `DbError`, `StorageError`, `OcrError`                                                                  |

## Key modules

| File                                                                                           | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pipeline.ts`](../../packages/core/src/pipeline.ts)                                           | The two stages (ingest, extract), retry claim, delete, and building `ocr_calls` rows                                                                                                                                                                                                                                                                                                                                                  |
| [`repository.ts`](../../packages/core/src/repository.ts)                                       | `ReceiptRepo`: scoped reads, insert under quota, complete and fail under the attempt guard, staleness                                                                                                                                                                                                                                                                                                                                 |
| [`jobs/`](../../packages/core/src/jobs)                                                        | The job queue: store and claim SQL, `tick`, the `receipt.extract` kind ([Background jobs](flows/jobs.md))                                                                                                                                                                                                                                                                                                                             |
| [`ocr.ts`](../../packages/core/src/ocr.ts)                                                     | `runChain`: shared deadline, per-step timeout, which failures fall back                                                                                                                                                                                                                                                                                                                                                               |
| [`billing/`](../../packages/core/src/billing)                                                  | Paddle adapter (signature, event parsing, portal session), provider-neutral event types, entitlement rules, `Billing` service and the apply step ([Billing](flows/billing.md))                                                                                                                                                                                                                                                        |
| [`quota.ts`](../../packages/core/src/quota.ts)                                                 | Turning usage counts into a verdict and a user-facing message                                                                                                                                                                                                                                                                                                                                                                         |
| [`usage.ts`](../../packages/core/src/usage.ts)                                                 | The ledger's counting rules in SQL, the user and workspace advisory locks, rollups for usage pages                                                                                                                                                                                                                                                                                                                                    |
| [`settings.ts`](../../packages/core/src/settings.ts)                                           | Zod schemas for plan limits and the chain, the cached loader, `save`                                                                                                                                                                                                                                                                                                                                                                  |
| [`plans.ts`](../../packages/core/src/plans.ts)                                                 | Plan defaults (Free 20 a day, 100 a month and a 300 a day pool; Pro 500 a month and 200 a day per workspace), `FREE_FAILED_ROUNDS = 5`                                                                                                                                                                                                                                                                                                |
| [`files.ts`](../../packages/core/src/files.ts)                                                 | Magic-byte sniffing and upload validation                                                                                                                                                                                                                                                                                                                                                                                             |
| [`workspace.ts`](../../packages/core/src/workspace.ts)                                         | Scope resolution, personal workspace creation, a fixed-window rate limiter                                                                                                                                                                                                                                                                                                                                                            |
| [`admin.ts`](../../packages/core/src/admin.ts), [`audit.ts`](../../packages/core/src/audit.ts) | Admin writes with their audit row in one transaction                                                                                                                                                                                                                                                                                                                                                                                  |
| [`admin-queries.ts`](../../packages/core/src/admin-queries.ts)                                 | Reads for the admin pages                                                                                                                                                                                                                                                                                                                                                                                                             |
| [`groups.ts`](../../packages/core/src/groups.ts)                                               | Receipt groups: CRUD, bulk membership, permission checks, limits under a per-workspace lock                                                                                                                                                                                                                                                                                                                                           |
| [`group-rules.ts`](../../packages/core/src/group-rules.ts)                                     | Group palette, limits, Zod schemas and types; no database code, so the browser imports it too                                                                                                                                                                                                                                                                                                                                         |
| [`receipt-fields.ts`](../../packages/core/src/receipt-fields.ts)                               | `parseReceiptDate` and `parseCurrency`, matching the `receipts` checks: a real ISO day from 2000 on, a three-letter code, else null. The repository nulls a date past the upload day + 1 on completion and refuses one on edit. Client-safe, so the editor imports the bounds too                                                                                                                                                     |
| [`config.ts`](../../packages/core/src/config.ts)                                               | `DATABASE_URL`, `S3_*`, `OCR_DAILY_CAP` via Effect `Config`                                                                                                                                                                                                                                                                                                                                                                           |
| [`analytics/spend.ts`](../../packages/core/src/analytics/spend.ts)                             | Home dashboard: one grouping-sets SQL statement per view, scoped to the workspace and to completed receipts (`receipts_org_created_at_idx`, base CTE materialized). Amounts are per currency and never summed across currencies; range presets with previous period, top 10 plus other for categories and merchants, 12 months, this month against last. `time-buckets.ts` and `dates.ts` are shared with the admin Operations charts |

## Data flow

The receipt lifecycle, as `receipts.status` sees it. A row is inserted straight into `processing`; `uploaded` exists
in the enum but the current code never writes it.

```mermaid
stateDiagram-v2
  [*] --> processing: ingestUpload (round 1)
  processing --> completed: complete() by the current attempt
  processing --> failed: its job is dead or cancelled (settleFailure)
  processing --> failed: no live job after 5 min (read as stale)
  failed --> processing: claimRetry (round 2 or 3)
  completed --> [*]
  failed --> [*]: 3 rounds used
```

"Stale" is computed when reading, not written: a row still `processing` five minutes after `updated_at` with no live
job (none, or an orphaned one, see [Background jobs](flows/jobs.md#orphaned-jobs)) is shown as `failed` with a "took
too long" message and can be retried (`STALE_AFTER_MS` in [`jobs/live.ts`](../../packages/core/src/jobs/live.ts)).
While its job is queued or running, a receipt reads as `processing` however long it waits.

The full sequences are in [Upload, extraction and result](flows/upload-and-extraction.md) and [Retry](flows/retry.md).

## Design principles and invariants

**Workspace scoping on every query.** `ReceiptRepo` builds every `where` from `inScope` (id and `organization_id`) or
`filterWhere` (always `organization_id`). Writes by users go through `writable`, which also requires
`user_id = caller` unless the caller's workspace role is `owner` or `admin` (`canManageAnyReceipt` splits on commas
and fails closed; roles are written exactly as `owner`, `admin` or `member` since `assertWorkspaceRole` guards every
write in Better Auth). A receipt whose uploader was
deleted (`user_id` null) can only be changed by an owner or admin. Non-UUID ids return "not found" before reaching
Postgres.

**Two stages, the second by id only.** `ingestUpload` validates, stores, inserts and enqueues the `receipt.extract`
job in the same transaction. `runExtraction` (one attempt) takes only a receipt id, scope and round and loads
everything else from the database and the bucket, so any runner of the [job queue](flows/jobs.md) can call it. It
records each attempt's calls and never marks the receipt failed; the job's final-failure hook does that through
`settleFailure`.

**The attempt guard.** `complete` and `fail` update only where `status = 'processing'` and `attempts` equals the round
that started the work (`currentAttempt`). A run that lost a race (the receipt was retried, deleted, or already
finished) matches no row and writes nothing to `receipts`.

**Quota ledger semantics.** In plain terms: each round is counted against the plan of its workspace, and the count
comes from a log of every attempt that is never edited or deleted. Usage is counted from `ocr_rounds` and `ocr_calls`
([`usage.ts`](../../packages/core/src/usage.ts)). `ocr_rounds.plan` records the plan the round drew from. Every limit, its
default, how it is counted and the check order are in the single
[Plans and limits table](flows/billing.md#plans-and-limits); in short:

| Window                                | Counts                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user's UTC day and month (Free)     | Rounds with `plan = 'free'` across all the user's workspaces (20 a day, 100 a month): distinct receipts with a successful call today, plus rounds still in flight (their job is live, or no calls yet and under 5 minutes old), plus finished failed paid rounds beyond the first 5 per window |
| Free pool, UTC day                    | Every `free` round started by anyone, failed ones included (default 300)                                                                                                                                                                                                                       |
| A workspace's UTC month and day (Pro) | Rounds with `plan = 'pro'` of that workspace, whoever uploaded them, counted like the Free day above                                                                                                                                                                                           |
| A user's last 60 seconds              | Every round started, failed or not                                                                                                                                                                                                                                                             |
| Global UTC day (`OCR_DAILY_CAP`)      | Every round started by anyone, plus every automatic retry attempt that called a model; only counted when the cap is set                                                                                                                                                                        |

- A round row is written when the upload or retry is accepted, in the same transaction as the quota check, under
  `pg_advisory_xact_lock(7301, hashtext(user_id))` and, on a workspace-scoped plan, the workspace lock
  `pg_advisory_xact_lock(7302, hashtext(organization_id))` taken second (`lockQuota`). Parallel uploads by one user, or
  by members of one Pro workspace, queue on those locks, so a burst can't all pass the check. The Free pool and the
  global cap take no lock and can overshoot by the number of uploads in flight.
- Call rows are written when each attempt ends (with `complete` on success, on their own after a failed attempt),
  priced at write time and never recomputed. An attempt that failed before any model ran gets one row with a null
  model and zero cost.
- Automatic retries reuse their round: they add `ocr_calls` rows (`job_attempt` 2 to 4), never `ocr_rounds` rows.
- Deleting a receipt does not delete ledger rows (no foreign key on `receipt_id`). Deleting a workspace or user sets
  their ids to null. Nothing refunds quota.
- The route also runs a read-only check (`enforceQuota`) before storing the file, to refuse early. The check under the
  lock is the one that counts.
- The plan comes from `workspacePlan` (read from the database on each upload), not from the user.

**Chain and fallback.** `runChain` in [`ocr.ts`](../../packages/core/src/ocr.ts):

- The active chain is the saved chain filtered to steps that are enabled and whose provider has a key.
- All steps share a 50 s deadline (`OCR_DEADLINE_MS`), well under the receipt job's 90 s lease. Each step gets
  `min(step.timeoutMs, time left)`, and no step starts with under 2 s left.
- Inside one step the AI SDK retries once (`STEP_MAX_RETRIES = 1`).
- `timeout`, `rate-limited`, `provider-error`, `not-configured`, `refused` and `unsupported-file` fall through to the
  next model. `invalid-output` and `bad-image` stop the chain: the image is usually the problem, and another model
  would cost another call.
- Every attempt, successful or not, is returned with its kind, latency and usage, and becomes an `ocr_calls` row.

**Settings fail closed.** A missing, invalid or unreadable `app_settings` row falls back to code defaults, never to
"unlimited". See [Settings cache](flows/settings-cache.md).

**Admin writes are atomic with their audit row.** `transact` runs the change and `insertAudit` in one transaction;
throwing `Conflict`, `NotFound` or `InvalidInput` inside rolls it back. Member changes lock all member rows of the
workspace (`FOR UPDATE`) so the "at least one owner" check can't race another admin.

**Files after rows.** Deletes remove database rows first and stored objects afterwards. A user's delete (one receipt
or many) deletes the rows and enqueues one `storage.delete` job with their object keys in the same transaction, so the
files go if and only if the rows did; the job retries until the bucket answers. Account and workspace purges still
delete objects inline and log a failure with its key (`admin.purge_failed`) rather than failing the request; an
orphaned object costs storage only. On ingest, the just-stored object is removed whenever the insert can't have
committed: a quota refusal, or any failure before the transaction's last statement finished. A failure while
committing (`DbError.atCommit`) keeps the object unless Postgres answered with a SQLSTATE outside class 08 (a
rollback); a timeout, a lost socket or a pooler's connection error may have committed, so `receipt.ingest_unknown`
logs the receipt id for a sweep.

## Receipt groups

A group is a named collection of receipts in a workspace; a receipt can be in several
([data model](data-model.md#receipt-groups)).

- **Who may do what.** Any member lists groups, creates them and adds or removes receipts (anyone's). Renaming,
  recolouring and deleting is for the group's creator and the workspace's `owner` and `admin` roles
  (`canManageGroup`, which fails closed like `canManageAnyReceipt`). Refusals are `Forbidden` (HTTP 403). A group whose
  creator was deleted can only be managed by owners and admins. Deleting a group never deletes receipts.
- **Scoping in SQL.** Every query filters on `organization_id`. A bulk add inserts with `insert ... select` from
  `receipts` joined to `receipt_groups` on `organization_id`, so ids from another workspace are counted as
  `notFound` and never linked. A group from another workspace is `NotFound`.
- **Limits.** `MAX_GROUPS_PER_WORKSPACE` (100) and `MAX_GROUPS_PER_RECEIPT` (20). Every group write takes a
  per-workspace advisory lock (namespace `7302`), so the counts and the case-insensitive name check can't be raced.
  A bulk add skips receipts already in 20 groups and reports them as `atLimit` instead of failing the call.
- **Input.** Names are trimmed, inner whitespace collapsed, 1 to 60 characters, no control or format characters
  (bidi overrides, zero-width). Colours come from `GROUP_COLORS`. Bulk calls take 1 to 100 UUIDs, deduplicated. Core
  validates with the same Zod schemas the routes use.
- **History and export.** `ReceiptFilters.groups` matches receipts in any of the given groups; `exportRows` adds the
  receipt's group names.
- **Audit.** Group changes are workspace actions, not platform admin actions, so they write no `admin_audit_log` rows.

## How to test it

| What                                      | Command                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Unit tests (`*.test.ts`, mocked services) | `bun run test`                                                                                        |
| Against Postgres and RustFS               | `bun run --filter @receipt-ocr/core test:int` with `DATABASE_URL` and `S3_*` set to a throwaway stack |

Unit tests provide fake layers (for example [`pipeline.test.ts`](../../packages/core/src/pipeline.test.ts),
[`ocr.test.ts`](../../packages/core/src/ocr.test.ts) with a test clock). The integration suites
[`receipts.int.test.ts`](../../packages/core/src/receipts.int.test.ts) and
[`admin.int.test.ts`](../../packages/core/src/admin.int.test.ts) run real transactions, locks and cascades; CI runs
them in the e2e job.

## Common changes

### Add a receipt query

Add a method to the `ReceiptRepo` tag type and its `Live` implementation. Start the `where` from `inScope`,
`filterWhere` or `eq(receipts.organizationId, scope.organizationId)`. For a user-initiated write, use `writable`.

### Change a quota rule

Change `usedSql` or `countUsage` in [`usage.ts`](../../packages/core/src/usage.ts) and the decision in
`decideQuota` ([`quota.ts`](../../packages/core/src/quota.ts)). Keep counting from the ledger, not `receipts`. Update
[`quota.test.ts`](../../packages/core/src/quota.test.ts), the receipts integration test, and the table above.

### Add a failure kind that should fall back

Add it to `OCR_FAILURE_KINDS` in [packages/ai](ai.md), to `OCR_CALL_STATUSES` in packages/db (a migration, because of
the `CHECK` constraint), and to `FALLBACK_KINDS` in [`ocr.ts`](../../packages/core/src/ocr.ts) if another model is
worth trying.

### Add an admin write

See [Admin actions](flows/admin-actions.md#add-an-admin-action).
