# Durable background jobs for Receipt OCR

2026-11-06 · Plan · Read-only research against `main` @ 5e2b4c6

## TL;DR

**Ship a hand-rolled Postgres job queue in our existing database, with one job interface in `packages/core` and two
execution adapters:** a long-running Bun worker (`apps/worker`, used in Docker and later in production), and an HTTP
drain route on Vercel (used in production now). On Vercel Hobby the drain route is triggered three ways: an `after()`
kick from the upload route, Supabase `pg_cron` + `pg_net` every minute, and a daily Vercel cron as a backstop.

- No new runtime dependency, and no new infrastructure.
- Works through the Supabase transaction pooler (6543), because there is no session state anywhere in the claim path.
- The receipt row stays the user-facing state machine. The `jobs` row becomes the execution state machine: queued,
  running, retry wait, dead. The quota round is reserved when the job is enqueued, in the same transaction. Automatic
  retries do not spend user quota.
- Change course later: move to pg-boss if we need many job kinds, flows or cron; add a Redis/BullMQ execution layer
  only past roughly 50 jobs/s. The trigger list is in [Decision](#decision).

---

## 1. What we have today

| Piece                                                                 | Behaviour                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/api/receipts/route.ts`                                  | `instant`: ingest, then `extractStored` inside the request (`maxDuration = 60`). `queued`: ingest, return 202, then `extractStored` in `after()`.                                                                                                                                                                                       |
| `apps/web/app/api/receipts/[id]/retry/route.ts`                       | `claimRetry` (quota lock, `attempts + 1`, new `ocr_rounds` row), then `extractStored` in `after()`.                                                                                                                                                                                                                                     |
| `packages/core/src/pipeline.ts` `extractStored({receiptId, scope})`   | Loads by id, so it can already run in a worker. Every failure goes to `markFailed`: the receipt becomes `failed` and the user has to retry by hand.                                                                                                                                                                                     |
| `packages/core/src/repository.ts`                                     | `insert` / `claimRetry` run under `pg_advisory_xact_lock(7301, hashtext(user))`, which works through the transaction pooler. `currentAttempt` guards writes (`status = 'processing' and attempts = N`). `STALE_AFTER_MS = 5 min`: a `processing` row older than that reads as failed and can be retried. `MAX_EXTRACTION_ATTEMPTS = 3`. |
| `packages/core/src/usage.ts`, migration 0007                          | `ocr_rounds` (one row per upload or retry, written when it is accepted) and `ocr_calls` (one row per model call, **unique `(receipt_id, round, step)`**). A round with no calls that is younger than `pendingSince` counts as in flight.                                                                                                |
| `packages/core/src/ocr.ts`                                            | Model chain under a 50 s deadline. `FALLBACK_KINDS` = timeout, rate-limited, provider-error, not-configured. One SDK retry per step.                                                                                                                                                                                                    |
| `apps/web/components/processing-poller.tsx`                           | Polls `GET /api/receipts/:id`, backing off from 2 s to 15 s, and gives up after 3 min.                                                                                                                                                                                                                                                  |
| `packages/db` `createDb`                                              | postgres.js, `prepare: false` (needed for the transaction pooler), `max` 5.                                                                                                                                                                                                                                                             |
| `docker-compose.yml`, `docker/Dockerfile.prod`, `scripts/test.sh`, CI | Postgres 18.6 and RustFS. The web image runs on Bun 1.4.4. The e2e job runs `next start` with `OCR_PROVIDER=fixture`.                                                                                                                                                                                                                   |

What breaks with `after()`:

- A deploy, a crash or the 60 s cap kills the job silently. The only recovery is the 5-minute stale rule plus a manual
  retry.
- Nothing retries transient errors such as Gemini 429s.
- Concurrency and rate are not controlled.
- Admins can't see what is waiting, running or failing.

### Platform facts (checked 2026-11-06)

| Fact                                                                                                                                                                                                                                                                          | Source                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Vercel **Hobby cron runs once per day at most**, with ±59 min precision. A more frequent expression fails the deploy. Cron Jobs are "legacy", being migrated to "Schedules".                                                                                                  | vercel.com/docs/cron-jobs/usage-and-pricing                            |
| Hobby function **max duration is 300 s** (default and maximum, Fluid). Pro allows 800 s, or 1800 s in beta. 2 GB / 1 vCPU.                                                                                                                                                    | vercel.com/docs/functions/limitations                                  |
| **Vercel Queues** is in beta on all plans. Hobby includes the first 1 M operations. At-least-once delivery, visibility timeout 0–60 min with ExtendLease, TTL up to 7 days, `maxDeliveries`, **no built-in DLQ**, topics pinned to the deployment that published them.        | vercel.com/docs/queues, /pricing, /concepts                            |
| **Vercel Daemons** are in beta. Hobby gets 5 Active CPU-h and 420 GB-h of memory per month, so one 1 GiB instance runs about 17 days, **not all month**. Production only, no `apps/web` root-directory projects yet.                                                          | vercel.com/docs/daemons/limits                                         |
| Supabase Cron (`pg_cron`) runs jobs "from every second to once a year" and can make HTTP requests (`pg_net`). Supabase recommends at most 8 concurrent jobs, each under 10 min.                                                                                               | supabase.com/docs/guides/cron                                          |
| Supabase Queues is built on the `pgmq` extension.                                                                                                                                                                                                                             | supabase.com/docs/guides/queues                                        |
| Transaction pooler (6543): no session state, so no `LISTEN`, no session advisory locks, no prepared statements. `NOTIFY` inside a transaction is delivered at commit, so producers may send it through 6543; **listeners need 5432** (session pooler) or a direct connection. | Supabase/Supavisor behaviour; `createDb` already sets `prepare: false` |

> **Hobby is for non-commercial use** under Vercel's terms. A paid SaaS has to move to Pro ($20/mo) anyway, and Pro
> unlocks per-minute cron, 800 s functions and Daemons. That changes the "later" hosting answer (§7).

---

## 2. Options compared

### 2a. Postgres-native variants, head to head

|                                | **(a) Hand-rolled `jobs` + `SKIP LOCKED`**              | **(b) pg-boss 12.38.0**                                                                                                                                | **(c) Graphile Worker 0.18.0**                                                   | **(d) pgmq / Supabase Queues**                                                                                                        |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| What it is                     | ~400 lines in `packages/core`: our table, our claim SQL | Mature queue library with its own `pgboss` schema                                                                                                      | Mature queue library with its own `graphile_worker` schema, SQL-function enqueue | Postgres extension: one table per queue, `send` / `read(vt)` / `archive` / `delete`                                                   |
| Driver                         | postgres.js (ours)                                      | `pg` (node-postgres) as a dependency. A `fromDrizzle(tx, sql)` adapter lets us **enqueue inside our transaction**.                                     | `pg`                                                                             | Plain SQL through our driver                                                                                                          |
| Where the worker runs          | Anywhere: worker loop or HTTP drain                     | `boss.work()` (long-running), or `fetch` / `complete` from a route                                                                                     | `run()` long-running; `runOnce` exists                                           | Anywhere, by calling `pgmq.read`                                                                                                      |
| Retries / backoff              | Ours: exponential, jitter, honours `Retry-After`        | `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`                                                                                            | Exponential, default 25 attempts over about 3 days                               | **None.** `read_ct` only, so we write our own.                                                                                        |
| Stuck-job recovery             | Lease (`locked_until`) + heartbeat + reaper             | `expireInSeconds`, optional `heartbeatSeconds` (≥ 10)                                                                                                  | **OSS: locked 4 h after a crash.** Heartbeat sweep is Worker Pro (paid).         | Visibility timeout (`vt`) and `set_vt` to extend                                                                                      |
| Dead letter                    | `state = 'dead'`, kept for 30 days                      | `deadLetter` queue with redrive                                                                                                                        | Stays in table with `last_error` once attempts run out                           | DIY (archive table)                                                                                                                   |
| Idempotency                    | Unique partial index on `idempotency_key`               | `singletonKey` and policies (`singleton`, `stately`, `exclusive`, `key_strict_fifo`)                                                                   | `job_key`                                                                        | DIY                                                                                                                                   |
| Per-user fairness              | Ours: per-owner running cap + priority                  | **`groupConcurrency` with tiers** (built in)                                                                                                           | Named queues run in series. Fairness is DIY.                                     | DIY                                                                                                                                   |
| Rate limit per provider        | Ours: DB window counter + cooldown row                  | Policies cover debounce and throttle, not "N calls/min to Gemini"                                                                                      | Via `graphile-worker-rate-limiter`                                               | DIY                                                                                                                                   |
| Cron                           | Ours: `job_schedules` with fixed intervals              | Cron + RRULE (`cron-parser`, `rrule-temporal` dependencies)                                                                                            | Crontab with backfill                                                            | DIY, or `pg_cron`                                                                                                                     |
| Dashboard                      | Ours, in `/admin`                                       | `@pg-boss/dashboard` 1.13.0 (Hono + React Router, separate server)                                                                                     | None OSS                                                                         | Supabase dashboard                                                                                                                    |
| Transaction pooler (6543)      | **Yes**, by construction                                | Polling works. LISTEN/NOTIFY falls back to polling with a warning. Schema DDL and maintenance use advisory locks, so **run its migrations over 5432**. | **No** for its listener. Needs a session connection.                             | Yes (plain SQL functions)                                                                                                             |
| Docker self-host               | Nothing extra                                           | Nothing extra                                                                                                                                          | Nothing extra                                                                    | **Needs the extension in our Postgres image.** `postgres:18.6-alpine` doesn't ship it, so we'd need a custom image in compose and CI. |
| Fits our schema and migrations | Drizzle owns everything                                 | It manages its own schema version, so Drizzle no longer owns all of it                                                                                 | Same                                                                             | Extension-managed                                                                                                                     |
| Ops burden                     | Lowest, but the code is ours to keep correct            | Low                                                                                                                                                    | Low, except the 4 h crash lock                                                   | Low DB-side, high DIY around it                                                                                                       |

**Newer Postgres options I looked at but don't recommend now:**

- **DBOS Transact** (`@dbos-inc/dbos-sdk` 5.4.0): durable workflows checkpointed in Postgres. Strong, but it is a
  programming model (decorated workflows and steps) that would wrap our Effect services. Too much for one job kind.
- **Absurd** (`absurd-sdk` 0.5.1, Apache-2.0): a durable-execution SQL schema. Pre-1.0.
- **pgflow**: a DAG workflow layer on pgmq and Supabase Edge Functions. Ties execution to Supabase.

These are worth another look if receipts ever become multi-step workflows (for example, multi-page PDF fan-out plus a
merge step).

### 2b. Redis and serverless

|                                            | Worker runs                                      | Durability                               | Retries / DLQ                                         | Stuck recovery                   | Provider rate limit                  | Concurrency      | Cron                  | Observability                      | Cost now                                                                                            | Ops / fit                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------- | -------------------------------- | ------------------------------------ | ---------------- | --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BullMQ 6.5.1 + Redis**                   | Long-running process (Railway, Fly, Daemon)      | Redis AOF. Adds a second store of truth. | attempts + backoff. Failed set acts as the DLQ.       | Lock + stalled checker           | `limiter {max, duration}` per queue  | Per worker       | `upsertJobScheduler`  | Bull Board or a custom UI (Midday) | Upstash free tier, but BullMQ's polling commands burn its request quota. Self-hosted Redis is $0–5. | Second infra and a second deploy target. **No worker on Vercel Hobby.** `msgpackr` pulls optional `msgpackr-extract` (native, **install script**). |
| **Vercel Queues** (`@vercel/queue` 0.11.0) | Push to a Vercel Function, or poll from anywhere | 3-AZ replicated                          | `maxDeliveries`, custom `retry` callback. **No DLQ.** | Visibility timeout + ExtendLease | Max concurrency per consumer group   | Per group        | Via cron or Schedules | Vercel Observability               | Hobby: 1 M ops included                                                                             | Beta. Vercel-only, so Docker self-host needs another path (poll mode needs Vercel OIDC). Topics pinned per deployment.                             |
| **Vercel Cron + drain route**              | Vercel Function                                  | Whatever the store is (Postgres)         | The store's                                           | The store's                      | The store's                          | Per invocation   | Hobby: **daily only** | Logs                               | $0                                                                                                  | A trigger only. Useless alone on Hobby.                                                                                                            |
| **Upstash QStash** (2.12.1)                | HTTP calls to our route                          | Upstash                                  | Retries, DLQ (3 days)                                 | Response timeout                 | Queue parallelism (2 on free)        | Parallelism ≤ 10 | 10 schedules free     | Upstash console                    | Free: **1,000 msgs/day, retries count**                                                             | Another vendor and secret. Fine as a trigger.                                                                                                      |
| **Inngest** (4.26.2)                       | Their orchestrator calls our route per step      | Inngest cloud                            | Steps, retries                                        | Theirs                           | Throttle and concurrency keys (good) | Yes              | Yes                   | Good UI (24 h history on free)     | Free: 50 k executions/month, 5 concurrent steps; Pro $99                                            | Vendor lock on the execution model. Self-hosting is possible but heavy.                                                                            |
| **Trigger.dev** (4.8.3)                    | Their compute (their containers)                 | Theirs                                   | Yes                                                   | Theirs                           | Queues, concurrency keys             | Yes              | Yes                   | Best-in-class run UI               | Free: $5 credit, 20 concurrent, 1 day logs                                                          | Code deployed to their platform. Self-host is Apache-2.0 but a large stack.                                                                        |
| **Cloudflare Queues**                      | Workers                                          | CF                                       | Retries + DLQ                                         | Yes                              | Batch / concurrency                  | Yes              | Cron Triggers         | CF dash                            | Workers Paid $5                                                                                     | Our OCR code is Node/Bun + Effect + AWS SDK. Running on Workers is a port. **No.**                                                                 |

### 2c. Combinations: one job store, swappable execution layer

| #   | Combination                                                                                                        | Now (Hobby + Supabase)                                                                                                             | Later                                          | Verdict                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | **Postgres queue + Bun worker container** (compose / Railway / Fly / VPS / Vercel Daemon)                          | Not possible on Vercel Hobby. Needs a paid host ($5/mo Railway, ~$3/mo Fly, ~€4 VPS).                                              | **Yes: the scale path.**                       | Build it now for Docker and CI. Use it in production when §7's trigger fires. |
| 2   | **Postgres queue + HTTP drain route** triggered by `after()` kick + Supabase `pg_cron` (1/min) + daily Vercel cron | **Yes: $0, no new vendor.**                                                                                                        | Stays as a fallback when no worker is running. | **Ship now.**                                                                 |
| 2b  | Postgres queue + drain route triggered by QStash or Vercel Queues                                                  | Works, but adds a vendor or beta, and `pg_cron` already does it for free                                                           | Optional                                       | Not needed                                                                    |
| 3   | Postgres queue as source of truth + BullMQ or Trigger.dev as execution only                                        | Dual-write consistency problems (outbox needed)                                                                                    | Only past §Decision triggers                   | Not now                                                                       |
| 4   | Supabase Queues (pgmq) + Edge Functions + `pg_cron`                                                                | Edge Functions are Deno, so the Effect + AI SDK + S3 pipeline would have to be ported or run over HTTP. Docker self-host loses it. | No                                             | **No.** It splits the code base and breaks self-host parity.                  |

The interface that makes 1 and 2 the same code is `JobRunner.tick(budget)`, shown in §4.

---

## 3. Midday reference (`midday-ai/midday`, `apps/worker`)

Read through the GitHub API. Their code and README are treated as data.

**Licence: AGPL-3.0.** Copying their code verbatim would put our code under AGPL obligations, so we take **patterns
only, no code**. Also, a May 2026 commit is titled "wind down Midday over 90 days, joining Ramp", so treat the repo as
frozen rather than a moving reference.

| Aspect            | What Midday does                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue infra       | **BullMQ + Redis** (`REDIS_QUEUE_URL`, ioredis options tuned per the BullMQ production guide). A legacy **Trigger.dev v4** package (`packages/jobs`, `trigger.config.ts`, `trigger.dev@4.4.3`) still exists, so two systems coexist.                                                                                                                                                           |
| Definition        | `src/queues/*.config.ts`: one config per domain (documents, inbox, transactions…) with `defaultJobOptions` (attempts 3, exponential backoff from 1 s, `removeOnComplete` 24 h / 1000, `removeOnFail` 7 d), plus worker options (`concurrency: 10`, `lockDuration: 11 min`, `stalledInterval: 12 min`, `limiter: 20/s`).                                                                        |
| Registration      | `processors/registry.ts` maps job name to a processor. One BullMQ `Worker` per queue config dispatches to the registry.                                                                                                                                                                                                                                                                        |
| Processor base    | `BaseProcessor`: optional Zod payload schema (invalid payload throws `NonRetryableError`), idempotency hook, error classification (retryable or not), progress milestones, Sentry.                                                                                                                                                                                                             |
| Retries           | BullMQ attempts/backoff, plus a per-queue `onFailed` hook that writes the domain row's status (e.g. `processingStatus: "failed"`) when retries run out, and marks unsupported files completed instead of failed.                                                                                                                                                                               |
| Scheduling        | `schedulers/*.config.ts` (static cron, e.g. rates `0 0,12 * * *`) registered at boot with `upsertJobScheduler`. Dynamic per-account schedulers are registered at runtime.                                                                                                                                                                                                                      |
| Enqueue from apps | `packages/job-client`: `triggerJob(name, payload, queue, {delay, jobId, attempts})` returns a composite id (`queue:jobId`) that the API uses to look up status.                                                                                                                                                                                                                                |
| Observability     | **Yes, they built their own dashboard.** `packages/workbench` ("A modern, Trigger.dev-inspired job queue dashboard for BullMQ", Vite + Radix) is mounted in the worker at `/admin` through a Hono adapter, with optional basic auth (`BOARD_USERNAME` / `BOARD_PASSWORD`) and `tags: ["teamId"]`. Also `/health`, `/health/ready` (DB + Redis probes), `/info`, pool-stats logging and Sentry. |
| Deploy            | `apps/worker/Dockerfile` (Bun 1.3.10, `turbo prune`, native build deps for sharp and HEIC), and **Railway** (`railway.json`: `numReplicas: 2`, healthcheck `/health`, `deploymentOverlapSeconds: 30`, `drainingSeconds: 15`, `restartPolicyType: ON_FAILURE`).                                                                                                                                 |
| Shutdown          | SIGTERM: close workers, then a 5 s grace, then close the DB and flush Sentry, with a 30 s cap. Uncaught errors are logged and the process does not exit.                                                                                                                                                                                                                                       |
| Code sharing      | The worker imports workspace packages (`@midday/db`, `@midday/documents`, …) directly, the same way we would import `@receipt-ocr/core`.                                                                                                                                                                                                                                                       |

**Copy as patterns:**

1. Typed job registry: `kind`, Zod payload, handler, per-kind policy (attempts, backoff, lease, concurrency,
   retention).
2. An explicit **non-retryable** classification. Ours maps from `OcrFailureKind`.
3. A final-failure hook that settles the domain row (receipt becomes `failed`) in the same place as retry logic.
4. `/health` and `/health/ready` on the worker, and a capped graceful shutdown.
5. A job dashboard with filtering by tenant. **We build it inside our `/admin`**, behind the Better Auth admin role,
   with audited actions. Their separate basic-auth UI on the worker is the part we avoid.
6. Retention per outcome: completed jobs kept briefly, failed jobs kept longer.

**Doesn't fit us:**

- Redis as a second store, and a worker that can't run on Vercel Hobby.
- Two job systems at once (BullMQ and Trigger.dev).
- `rm -f bun.lock && bun install` in their Dockerfile, which breaks our frozen-lockfile and 7-day-cooldown policy.
- Never exiting on uncaught exceptions.
- Per-domain queue sprawl. We have one domain.

---

## 4. Design

### 4.1 Job model

**Kinds.** Each lives in `packages/core/src/jobs/kinds/*.ts` and is registered in one map.

| Kind                            | Payload                                      | Priority              | Max attempts | Lease | Notes                                                                                    |
| ------------------------------- | -------------------------------------------- | --------------------- | ------------ | ----- | ---------------------------------------------------------------------------------------- |
| `receipt.extract`               | `{receiptId, organizationId, userId, round}` | 0 interactive, 5 bulk | 4            | 90 s  | Covers uploads and user retries. Each is a new round.                                    |
| `receipt.extract-batch` (later) | `{receiptIds[], model}`                      | 8                     | 10           | 120 s | Gemini Batch or Flex. Submits, then reschedules itself to poll (`run_at = now + 5 min`). |
| `usage.purge` (later)           | `{before}`                                   | 9                     | 3            | 300 s | Retention of `ocr_calls` / jobs. Comes from a schedule.                                  |
| `import.bulk` (later)           | `{importId, cursor}`                         | 5                     | 5            | 120 s | Fans out `receipt.extract` jobs in pages, re-enqueuing itself with the cursor.           |

**States.** `queued` (includes "waiting for retry": `run_at` is in the future) → `running` → `succeeded`, `dead`
(retries exhausted or non-retryable) or `cancelled`. `failed` is not a resting state: a failed attempt goes back to
`queued` with a later `run_at`, or to `dead`.

```
queued ──claim──▶ running ──ok──▶ succeeded
  ▲                 │ retryable error & attempts < max ─▶ queued (run_at = now + backoff)
  │                 │ non-retryable or attempts = max  ─▶ dead
  │                 └ lease expired (crash/deploy)     ─▶ reaper ─▶ queued, or dead if attempts = max
  └── admin re-run (dead/cancelled ─▶ queued, attempts reset)       admin cancel (queued ─▶ cancelled)
```

**Backoff.** `delay = min(cap, base × 2^(attempt-1)) × (0.5 + random()/2)`, with base 10 s and cap 10 min. For
`rate-limited`, the delay is `max(Retry-After, backoff)`. Schedule for `receipt.extract`: about 10 s, 20 s, 40 s, then
dead.

**Retryable kinds.** From `OcrFailureKind`:

- Retry: `timeout`, `rate-limited`, `provider-error`, `storage-error`, `DbError`.
- Dead now: `invalid-output`, `bad-image`, `NotFound`, `Conflict`.
- `not-configured` is dead now, and an admin can re-run once keys are fixed.

**Schema** (migration 0008, Drizzle-owned):

```sql
create type job_state as enum ('queued','running','succeeded','dead','cancelled');

create table jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  state           job_state not null default 'queued',
  priority        smallint not null default 0,          -- lower runs first
  payload         jsonb not null,
  idempotency_key text,
  receipt_id      uuid,                                 -- no FK: the job record outlives a deleted receipt
  organization_id text,                                 -- for admin filters and per-tenant fairness
  user_id         text,
  attempts        smallint not null default 0,          -- incremented at claim
  max_attempts    smallint not null,
  run_at          timestamptz not null default now(),
  locked_by       text,                                 -- worker id
  locked_until    timestamptz,                          -- lease; deliberately unindexed (HOT heartbeats)
  last_error      jsonb,                                -- {kind, message, at} — no receipt contents
  attempt_log     jsonb not null default '[]',          -- last 5 attempts {n, at, ms, outcome, worker}
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz not null default now()
) with (fillfactor = 80,
        autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 200,
        autovacuum_analyze_scale_factor = 0.05);

-- The claim index: only runnable rows, in claim order.
create index jobs_runnable_idx on jobs (priority, run_at) where state = 'queued';
-- Reaper and per-owner running counts: a small set.
create index jobs_running_idx on jobs (user_id) where state = 'running';
-- Dedupe: one live job per key; finished jobs free the key.
create unique index jobs_idem_idx on jobs (idempotency_key) where state in ('queued','running');
-- At most one live extract per receipt.
create unique index jobs_receipt_live_idx on jobs (receipt_id) where state in ('queued','running') and kind like 'receipt.%';
-- Admin lists and retention.
create index jobs_state_finished_idx on jobs (state, finished_at);
create index jobs_org_created_idx on jobs (organization_id, created_at);

create table job_workers (      -- presence, for the admin page and the "no worker" banner
  id text primary key, mode text not null,  -- 'worker' | 'drain'
  host text, version text, concurrency smallint,
  started_at timestamptz not null default now(), last_seen_at timestamptz not null default now());

create table job_controls (     -- pause/resume and provider cooldowns, one row per scope
  scope text primary key,       -- 'queue' | 'kind:receipt.extract' | 'provider:google'
  paused boolean not null default false,
  until timestamptz,            -- cooldown end (429), null = indefinite pause
  reason text, updated_by text, updated_at timestamptz not null default now());

create table rate_windows (     -- fixed-window counters for per-model RPM
  key text not null, window_start timestamptz not null, count int not null default 0,
  primary key (key, window_start));

create table job_schedules (    -- recurring jobs without a scheduler process
  name text primary key, kind text not null, payload jsonb not null default '{}',
  every_seconds int not null, next_run_at timestamptz not null, enabled boolean not null default true);

alter table ocr_calls add column job_attempt smallint not null default 1;
drop index ocr_calls_receipt_round_step_idx;
create unique index ocr_calls_receipt_round_attempt_step_idx on ocr_calls (receipt_id, round, job_attempt, step);
```

**Relations.** `receipts` 1 to many `jobs`, and at most one is live at a time (partial unique index). Each job carries
`round` = `receipts.attempts` at enqueue. The existing `currentAttempt` guard (`status = 'processing' and attempts =
round`) is the fencing token, so a zombie job from an older round or an expired lease can never overwrite a newer
result. That rule exists today and the queue relies on it.

**Quota and ledger.**

- **Reserved at enqueue.** `ReceiptRepo.insert` and `claimRetry` already lock the user (`pg_advisory_xact_lock`), check
  the quota, and write the `ocr_rounds` row. **The `jobs` insert joins that same transaction.** Either the receipt,
  round and job all commit, or none of them do. There is no "receipt with no job" state.
- **Automatic retries are not new rounds.** They reuse the round and write `ocr_calls` with `job_attempt = n`. The quota
  rules in `usage.ts` don't change. A round counts once if any attempt read the receipt (`readOk`). It counts as failed
  and paid only if model calls happened and none succeeded. The in-flight rule ("round with no calls younger than
  `pendingSince`") still covers a job that hasn't started.
- **Cost stays exact.** Every attempt's calls are billed in `ocr_calls`, so cost and token rollups stay correct.
- **Admin re-run is not a new round.** It re-queues the same job and round with attempts reset, so the user isn't
  charged for our outage. It is audited (§6).
- **User retry is a new round.** `claimRetry` is unchanged in spirit: `failed` → `processing`, `attempts + 1`, new round,
  and enqueue in the same transaction.

**Stale rule and `claimRetry` changes.**

- `isStale` (5 min) currently turns slow queued work into "failed". Replace it with job-aware status:
  - `processing` + live job `queued` reads as **"Waiting in queue"** (or "Retrying in 20 s, attempt 2 of 4").
  - `processing` + live job `running` reads as **"Reading"**.
  - `processing` + **no live job** + older than 5 min reads as failed. This is a legacy safety net only, for rows created
    before the migration.
- `claimRetry` drops the `or isStale` branch. It only accepts `status = 'failed'`, because the job is dead and the
  receipt was settled. A one-time backfill in migration 0008 enqueues a job for every `processing` receipt that has
  none (or marks rows older than 1 h failed).
- `extractStored` is split so the handler decides what happens:
  - `runExtraction` returns `Either<Outcome, Failure>`. It records calls with `job_attempt` and **does not** mark the
    receipt failed.
  - `settleFailure(final: boolean)` calls `repo.fail` only when the job is going to `dead`.
  - The success path is unchanged: `repo.complete` under the attempt guard, with calls in the same transaction.

### 4.2 The queue SQL

**Claim** (one statement, pooler-safe, batch of `n`):

```sql
with ctl as (
  select coalesce(bool_or(paused and (until is null or until > now())), false) as stopped
  from job_controls where scope = 'queue'
), busy as (                         -- per-owner running cap (fairness)
  select user_id from jobs where state = 'running' group by user_id having count(*) >= $owner_cap
), picked as (
  select j.id from jobs j
  where j.state = 'queued' and j.run_at <= now()
    and j.kind = any($kinds)
    and not (select stopped from ctl)
    and not exists (select 1 from job_controls c
                    where c.scope = 'kind:' || j.kind and c.paused and (c.until is null or c.until > now()))
    and (j.user_id is null or j.user_id not in (select user_id from busy))
  order by j.priority, j.run_at
  limit $n
  for update skip locked
)
update jobs j set state = 'running', attempts = j.attempts + 1, locked_by = $worker,
       locked_until = now() + make_interval(secs => $lease), started_at = now(), updated_at = now()
from picked where j.id = picked.id
returning j.*;
```

**Heartbeat:** `update jobs set locked_until = now() + lease where id = $1 and locked_by = $worker and state =
'running'`. It touches no indexed column, so the update is HOT. **0 rows means the job was lost to the reaper, or an
admin cancelled it:** abort the handler through Effect interruption (`AbortSignal` into the AI SDK).

**Complete / retry / dead:** each is a single `update … where id = $1 and locked_by = $worker and state = 'running'`.
That fencing means a late writer whose lease expired changes nothing.

**Reaper**, run at the start of every tick:

```sql
update jobs set state = case when attempts >= max_attempts then 'dead' else 'queued' end,
       run_at = now(), locked_by = null, locked_until = null, updated_at = now(),
       last_error = jsonb_build_object('kind','lease-expired','at',now())
where id in (select id from jobs where state = 'running' and locked_until < now()
             for update skip locked limit 100)
returning id, state, receipt_id;
```

A job reaped to `dead` settles its receipt as failed through the same `settleFailure`. A crash-looping poison job dies
after `max_attempts` claims, because attempts increment when the job is claimed.

**Idempotency.**

- `receipt.extract` uses the key `receipt:{id}:round:{n}`. A double-clicked retry or a replayed request collides on the
  unique index, and the insert does `on conflict do nothing`.
- Scheduled jobs use the key `{schedule}:{slot}`.
- Handlers are idempotent anyway, thanks to the attempt guard.

**Priorities and fairness.**

- Interactive uploads get priority 0. Bulk import and batch work get 5–8. Maintenance gets 9.
- The per-owner running cap (default 2, set in admin settings) stops one user's 500-file import from occupying every
  slot. Other users' priority-0 jobs claim first, and the importer still progresses two at a time.
- The cap is soft across concurrent claimers: it can overshoot by at most the number of claimers times `n`, which is
  acceptable.
- If tenants ever need strict round-robin, replace the `order by` with a `row_number() over (partition by user_id order
by run_at)` ranking. That is a single SQL change.

**Per-provider rate limiting (Gemini 429s).**

1. **Concurrency per model, in-process.** An Effect `Semaphore` per model, sized from admin settings (`maxConcurrent`,
   a new field on `ocrStepSchema`).
2. **RPM across processes.** Before each model call: `insert into rate_windows (key, window_start, count) values
('model:google:gemini-3.8-flash', date_trunc('minute', now()), 1) on conflict (key, window_start) do update set count
= rate_windows.count + 1 where rate_windows.count < $rpm returning count`. No row back means the window is full. The
   step then reports `rate-limited` locally, and the chain falls back to the next model or the job backs off. This is
   one round trip, atomic and pooler-safe. The purge job deletes windows older than 1 h.
3. **Cooldown on a real 429.** Upsert `job_controls('provider:google', until = now() + Retry-After)`. `activeChain`
   treats a cooling provider as unavailable. When the whole chain is cooling, the job re-queues with `run_at = until`
   without spending an attempt (a `deferred` outcome).

**Scheduled jobs without a scheduler.** Each tick runs:

```sql
update job_schedules set next_run_at = next_run_at + make_interval(secs => every_seconds)
where name in (select name from job_schedules where enabled and next_run_at <= now() for update skip locked)
returning *;
```

It then enqueues each returned row with the idempotency key `name:next_run_at`. Fixed intervals only (hourly, daily),
so there is no `cron-parser` dependency. A missed window runs once on the next tick and does not backfill.

**Wake-up: polling, with NOTIFY as an optional hint.**

- **Worker.** Poll every 1 s while busy, backing off to 5 s when idle. The query is an index-only probe on a partial
  index of a handful of rows, so 1 query/s costs nothing.
  - **Optional:** `LISTEN jobs_new` on a **separate session connection** (`DIRECT_URL` / 5432, `max: 1`). Producers run
    `select pg_notify('jobs_new', kind)` inside the enqueue transaction, which works through 6543. NOTIFY only shortens
    the wait; polling remains the source of truth.
  - Skip LISTEN in the first PR. Add it if p50 queue wait matters.
- **Drain route.** No LISTEN. It loops until the queue is empty or its time budget runs out.

**Bloat and vacuum.**

- `fillfactor = 80` leaves room on each page for HOT updates (heartbeats and `attempt_log` changes).
- State transitions do touch the partial index predicates, so they are not HOT. Aggressive per-table autovacuum (above)
  keeps dead tuples low.
- At about 10 k jobs/day this table stays under 100 k rows with retention, and no partitioning is needed.
- **Retention** comes from the `jobs.purge` schedule, run daily: delete `succeeded` after 7 d and `dead`/`cancelled`
  after 30 d, in batches of 1,000 (`delete … where id in (select id … limit 1000)`) so locks stay short.
- **Partitioning:** revisit at more than about 1 M jobs/day. Then partition by `created_at` month and drop old
  partitions instead of deleting rows.

**Lock contention at N workers.** `FOR UPDATE SKIP LOCKED` on a `limit n` subquery means claimers never wait on each
other, so throughput scales roughly linearly to dozens of claimers. The quota advisory lock is per user and is held only
during enqueue (milliseconds). The worker never takes it.

### 4.3 The interface (`packages/core/src/jobs`)

```ts
// One store, one registry, two runners. Route handlers and apps/worker only call these.
export class JobQueue extends Context.Tag("@receipt-ocr/core/JobQueue")<JobQueue, {
  enqueue: (tx: Tx, job: NewJob) => Effect.Effect<{ id: string } | { duplicate: true }, DbError>;
  claim: (worker: WorkerId, kinds: readonly JobKind[], n: number) => Effect.Effect<Job[], DbError>;
  heartbeat: (job: Job) => Effect.Effect<boolean, DbError>;
  settle: (job: Job, outcome: JobOutcome) => Effect.Effect<void, DbError>; // succeeded | retry(at) | deferred(at) | dead
  reap: Effect.Effect<Job[], DbError>;
  runSchedules: Effect.Effect<number, DbError>;
}>() {}

export type JobDefinition<P> = {
  kind: JobKind; payload: z.ZodType<P>; maxAttempts: number; leaseSeconds: number;
  concurrency: number; retention: { succeededDays: number; deadDays: number };
  run: (payload: P, ctx: JobContext) => Effect.Effect<void, JobFailure, R>; // JobFailure has `retryable`
};

/** Claims and runs jobs until `budget` says stop. Used by both adapters. */
export const tick = (opts: { worker: WorkerId; budgetMs: number; concurrency: number; stopClaimingBeforeMs: number })
  => Effect.Effect<TickStats, never, JobQueue | Registry | ...>;
```

| Adapter                             | Where                                                   | Loop                              | Budget                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker` (Bun)                 | Docker compose, CI, later Railway/Fly/VPS/Vercel Daemon | `forever(tick)` with idle backoff | Unlimited. On SIGTERM: stop claiming, wait for in-flight jobs up to 60 s, then release unfinished leases (`state = 'queued'`, `run_at = now()`, attempt **not** counted), close the pool, exit. |
| `POST /api/jobs/drain` (Next route) | Vercel                                                  | One `tick` per call               | `maxDuration = 300` (Hobby). Stop claiming at 240 s (OCR deadline 50 s + write). Concurrency 3.                                                                                                 |

Swapping execution (worker ↔ drain, and later Vercel Queues or BullMQ as a pure "wake-up" signal) changes no job
definition and no table.

### 4.4 Worker (`apps/worker`)

- **Code:** `src/index.ts`, about 150 lines.
  - Build the Effect layer from `@receipt-ocr/core`: `Db.Live`, `Storage.Live`, `Settings`, `Ocr.Live`, `JobQueue.Live`.
  - Register the worker in `job_workers` and upsert `last_seen_at` every 15 s.
  - Run `tick` forever.
  - `Bun.serve` exposes `/health` (process up) and `/health/ready` (`select 1` + last tick under 30 s ago). This is the
    Midday pattern.
- **Concurrency:** env `WORKER_CONCURRENCY` (default 4), capped by per-kind `concurrency` and per-model semaphores
  from admin settings, which are re-read every 30 s through the existing `Settings` cache.
- **Logging:** one wide event per job attempt (`job.run`: kind, attempt, outcome, ms, model, cost) through the same
  logger shape as `lib/log.ts`. Move that shape into core, or a tiny shared logger.
- **DB:** `DATABASE_URL` (6543 in production) with `DATABASE_POOL_MAX = WORKER_CONCURRENCY + 2`. `DIRECT_URL` is only
  for the optional LISTEN.
- **Docker:** add a `worker` target to `docker/Dockerfile.prod` that reuses the `builder` install layer (frozen
  lockfile, same Bun digest) and runs `CMD ["bun","apps/worker/src/index.ts"]` as the non-root user. No bundling: Bun
  runs TypeScript directly.
- **Compose:** `worker` service with `depends_on: migrate`, the same env anchor as `app`, profile `app`. A `worker-dev`
  service with `bun --watch` under profile `dev`.
- **Locally:** `bun run worker` (root script → `--filter @receipt-ocr/worker dev`). Or set `JOBS_EXECUTION=drain` and
  use no worker.

### 4.5 Web side

- **Upload route.** `ingestUpload` inserts receipt, round and job in one transaction, with an optional `pg_notify`.
  Then, by `JOBS_EXECUTION`:
  - `worker`: respond 202.
  - `drain` (Vercel now): respond 202 and `after(() => drainOnce({ budgetMs: 55_000 }))`. Latency is like today, but if
    that `after()` dies, the job is still in the table and the next trigger finishes it.
- **Instant mode: drop it** (this is the CTO review's P2-6).
  - Why: it is a second code path, it holds a 60 s request, and it bypasses the queue, so it bypasses retries, rate
    limits and fairness.
  - Keep accepting `mode=instant` for one release and treat it as queued.
  - Before: instant upload finished in about 8 s. After: 202 in about 1 s, and the client polls at 1 s for the first
    15 s, so it sees completion within about 1 s of the worker finishing.
- **Retry route.** `claimRetry` enqueues in its transaction, then follows the same `JOBS_EXECUTION` switch.
- **Drain route.** `POST /api/jobs/drain` with `Authorization: Bearer ${JOBS_DRAIN_SECRET}`, compared in constant
  time. It also accepts Vercel's `CRON_SECRET` header for the cron trigger. It is never callable by users. Callers:
  1. **Supabase `pg_cron` every minute.** `select net.http_post(url := '<prod>/api/jobs/drain', headers :=
jsonb_build_object('authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where
name='jobs_drain_secret')))`. Setup goes in `docs/deployment.md`. It is skipped in Docker, where the worker runs.
  2. `vercel.json` cron `0 3 * * *`, the daily backstop that also runs the purge. Allowed on Hobby.
  3. Optionally, an admin "Drain now" button.
- **How the client learns completion: keep polling.** No SSE.
  - SSE on Vercel keeps a function alive and billed for the whole wait, capped at 300 s, and adds a second transport.
  - Polling a cheap `GET /api/receipts/:id` is fine at this scale.
  - Change: `GET` returns `job: {state, attempt, maxAttempts, runAt}`. The poller shows "Waiting in queue", "Retrying
    in 20 s (2/4)" or "Reading…".
  - Poll at 1 s for 15 s, then back off to 15 s. Stop when the job reaches a terminal state, not after a fixed 3 min.
- **No worker running.**
  - With `JOBS_EXECUTION=worker` and no `job_workers` row seen in the last 60 s, the upload route falls back to the drain
    path (`after()` kick). It logs `jobs.no_worker`, and `/admin/jobs` shows a red banner.
  - With `JOBS_EXECUTION=drain`, `pg_cron` is the safety net. The admin page warns if the oldest queued job is older
    than 3 min.

### 4.6 Admin (`/admin/jobs`)

- **Overview:**
  - Depth by state and kind.
  - **Oldest waiting** (`min(run_at) where queued and run_at <= now()`).
  - Throughput: succeeded, dead and retries per hour for the last 24 h, from `finished_at`.
  - p50/p95 wait (`started_at - created_at`) and run time.
  - **Failures by kind**: `last_error->>'kind'` grouped (rate-limited, timeout, bad-image…).
  - Live workers from `job_workers`.
  - Active pauses and cooldowns from `job_controls`.
- **List:** filters for state, kind, error kind, workspace and since. Each row links to its receipt and shows
  `attempt_log`.
- **Actions** run through `packages/core/src/jobs/admin.ts`. Each one runs in one transaction with `insertAudit` and
  `targetType: 'job'` (extend `AuditTarget`):
  - **Re-run one** (dead or cancelled → queued, attempts reset, receipt → `processing` under the same round).
  - **Re-run failed by kind** (e.g. all `rate-limited` dead since T).
  - **Re-run all dead since T.** Capped at 1,000 per action, with a dry-run count shown first ("This will re-queue 412
    jobs").
  - **Cancel** (queued → cancelled, receipt → failed "Cancelled by admin").
  - **Pause / resume** the queue or one kind, with a reason.
  - **Clear a provider cooldown.**
- **Audit metadata:** filter, count and job ids (first 50). Never payload contents.

### 4.7 Tests

| Layer                                           | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`vitest`)                                 | Backoff with jitter bounds and `Retry-After`. `OcrFailureKind` → retryable mapping. Registry payload validation (bad payload → dead, no retry). `tick` budget: stops claiming before the deadline. Graceful-shutdown state machine with a fake `JobQueue`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Integration (`*.int.test.ts`, compose Postgres) | **Concurrent claimers:** 5 claimers × 200 jobs, each claimed exactly once. **Crash mid-job:** claim, set `locked_until` in the past, reaper re-queues, a second worker completes, and the first worker's late `settle` changes 0 rows (fencing). **Retries:** fake `Ocr` fails `rate-limited` twice then succeeds. Asserts `ocr_calls` has rows for `job_attempt` 1–3, the receipt is completed, and the quota counts 1. **Dead letter:** always `timeout` → dead after 4 attempts, receipt failed, `claimRetry` then works and creates round 2. **Non-retryable:** `bad-image` → dead after 1 attempt. **Idempotency:** a duplicate enqueue is a no-op. **Fairness:** user A with 50 jobs and user B with 1, B claimed within the first batch. **Pause** blocks claims. **Cooldown** defers without spending attempts. **Admin bulk re-run** writes one audit row and doesn't add a round. **Retention purge** removes only old terminal jobs. **Legacy backfill** works. |
| E2E (Playwright via `scripts/test.sh` and CI)   | `scripts/test.sh` starts `bun run worker &` with the test env after `db:migrate`, and kills it on `trap`. Specs: upload → completed (worker); fixture failure marker → dead → "Try again" → completed on round 2; admin re-run from `/admin/jobs`; **kill test:** `FIXTURE_SLOW_MARKER` delays 10 s, `kill -9` the worker mid-job, restart it, and the receipt still completes. A second Playwright project runs with `JOBS_EXECUTION=drain` and no worker, to cover the Vercel path. CI `e2e` job: same steps. Add a `--worker` flag to `scripts/test.sh`, on by default.                                                                                                                                                                                                                                                                                                                                                                                                 |

Fixture additions in `packages/ai/src/fixture.ts`: `FIXTURE_SLOW_MARKER` (sleep N ms) and `FIXTURE_FLAKY_MARKER`
(fails with `rate-limited` until `job_attempt` ≥ k, with the attempt passed through `ExtractReceiptInput` metadata).

---

## 5. Dependencies

**Recommended design: zero new runtime dependencies.** It uses postgres.js, Drizzle, Effect and Zod, which are already
in the tree. The worker uses `Bun.serve`, so there is no Hono.

For reference, if a fallback path is ever taken. Each entry is the newest stable release at least 7 days old on
2026-11-06 (cutoff 2026-10-30). The newer release that is blocked is in brackets.

| Package            | Version (publish date)                                                    | Licence | Install scripts | Notes                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------- | ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-boss            | **12.38.0** (2026-10-13) [12.38.1, 11-05]                                 | MIT     | none            | Adds `pg` **8.23.1** (2026-09-30), `cron-parser`, `rrule-temporal`, `serialize-error`. Needs Node ≥ 22.12 or Bun. Has `fromDrizzle` and Bun adapters. |
| @pg-boss/dashboard | 1.13.0 (2026-10-27)                                                       | MIT     | check           | Hono, React 19, React Router 8, `pg`. A separate server.                                                                                              |
| graphile-worker    | **0.18.0** (2026-09-08)                                                   | MIT     | none            | `pg`, `cosmiconfig`, `yargs`, `graphile-config` beta. Node ≥ 22.18.                                                                                   |
| bullmq             | **6.5.1** (2026-10-28) [6.7.1, 11-06]                                     | MIT     | none itself     | `msgpackr` 2.1.4 → optional `msgpackr-extract` (**native install script**, node-gyp-build). Plus `ioredis` **6.0.0** (2026-07-31).                    |
| @vercel/queue      | 0.11.0 (2026-11-02) — **too new**; take the previous release ≥ 7 days old | —       | —               | Beta API (`queue/v2beta` trigger).                                                                                                                    |
| @upstash/qstash    | 2.12.1 (2026-10-20)                                                       | MIT     | none            |                                                                                                                                                       |
| inngest            | 4.26.2 (2026-10-29)                                                       | —       | —               | Large dependency tree (OpenTelemetry, protobuf).                                                                                                      |
| @trigger.dev/sdk   | 4.8.3 (2026-10-30) — on the cutoff day                                    | —       | —               | Code deployed to their platform.                                                                                                                      |

Versions and dates come from `npm view` on 2026-11-06. Re-check with `bun install --frozen-lockfile` under
`bunfig.toml`'s `minimumReleaseAge = "7d"` when adding any of them.

---

## 6. Hosting implication

| Stage                                                          | Execution                                                                                                                                                      | Cost               | Notes                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now: Vercel Hobby + Supabase**                               | Drain route, triggered by `after()` kick, `pg_cron` every minute, and the daily Vercel cron                                                                    | $0                 | Worst case after a crash: the job resumes within about 1–2 min (lease 90 s + next `pg_cron` tick). Each drain is bounded to 300 s and processes about 40–80 receipts per invocation at concurrency 3.                                              |
| **Docker self-host**                                           | `worker` service in compose next to `app`                                                                                                                      | $0 extra           | The same image and code. `JOBS_EXECUTION=worker`.                                                                                                                                                                                                  |
| **Later, when going commercial (Vercel Pro is needed anyway)** | **Vercel Pro + `apps/worker` as a Vercel Daemon** (one 1 GiB instance), or Railway ($5 plan, Midday's choice) / Fly (~$3/mo shared-cpu-1x) / Hetzner VPS (~€4) | $0–5 on top of Pro | Pro also allows per-minute cron, so the drain route keeps working as the fallback. Daemons have **no preview deploys** and **can't attach to an `apps/web` root-directory project yet**, so check before choosing. Railway has the fewest caveats. |

---

## 7. Migration path (PR tracks)

1. **Track A: job store and core** (M, opus).
   - Migration 0008: `jobs`, `job_workers`, `job_controls`, `rate_windows`, `job_schedules`; `ocr_calls.job_attempt`;
     the unique index swap; backfill.
   - `packages/core/src/jobs/*`: `JobQueue`, registry, `tick`, backoff, `receipt.extract` handler.
   - Split `extractStored` into `runExtraction` + `settleFailure`.
   - `ReceiptRepo.insert` / `claimRetry` enqueue in their transaction.
   - Job-aware status replaces `isStale`.
   - Integration tests from §4.7.
   - Routes still call `after()`, but now `after(() => drainOnce())`, so behaviour is the same and the work is durable.
2. **Track B: execution adapters and web** (M, sonnet).
   - `apps/worker`, the `POST /api/jobs/drain` route, `JOBS_EXECUTION` switch, no-worker fallback.
   - Drop instant mode. Poller shows job state.
   - Compose `worker` + Dockerfile `worker` target. `vercel.json` daily cron.
   - `docs/deployment.md`: `pg_cron` + Vault setup, envs `JOBS_EXECUTION`, `JOBS_DRAIN_SECRET`, `WORKER_CONCURRENCY`.
   - `scripts/test.sh` / CI start the worker. E2E incl. kill test and drain project.
   - Knip / `check:deps` for the new workspace.
3. **Track C: admin queue page** (S–M, sonnet + principal-designer pass).
   - `/admin/jobs` overview, list and detail.
   - Re-run (single, by kind, since T, with a dry-run count), cancel, pause/resume, clear cooldown. All audited.
   - No-worker / oldest-waiting banners.
4. **Track D: limits and schedules** (S–M, sonnet). This one can wait until it's needed.
   - Per-model `maxConcurrent` / `rpm` in admin OCR settings, `rate_windows`, provider cooldown on 429 → `deferred`.
   - Per-owner running cap in settings.
   - `job_schedules` + `jobs.purge` / `usage.purge`.
   - Then `receipt.extract-batch` (Gemini Batch/Flex) as a new kind, with no queue changes.

Tracks A and B are sequential. C can start once A lands, in parallel with B. Each track is roughly one PR.

---

## Decision

**Ship:** a hand-rolled Postgres job queue (`jobs` table, `FOR UPDATE SKIP LOCKED` claim, leases with heartbeat and
reaper, attempt-guarded writes) behind one `JobQueue`/`tick` interface in `packages/core`. Two adapters: a Bun
`apps/worker` for Docker and CI, and a Vercel drain route triggered by `after()`, Supabase `pg_cron` each minute and a
daily Vercel cron. Production starts in drain mode on Hobby. Instant mode goes away. Clients keep polling.

**Why this beats the alternatives here** (one developer; Vercel + Supabase; Docker parity):

- **No new store or vendor, and nothing new to pay for.** The job store sits in the same database and the same
  transaction as the receipt, the round and the quota lock. That makes "quota reserved at enqueue" and "no receipt
  without a job" true by construction, not by an outbox. pg-boss can do transactional enqueue too (`fromDrizzle`), but
  BullMQ and every serverless queue need an outbox.
- **Pooler-proof.** Only plain statements and transactions. Graphile Worker's listener fails this, and pg-boss needs
  5432 for its DDL and maintenance.
- **One job kind today.** The library features we'd pay for (flows, RRULE cron, many queues) are unused. The parts we do
  need are ours to define. Fencing by receipt attempt, admin re-run without charging quota, and a provider cooldown
  shared with the OCR chain are domain logic that no library gives us. Their total is about 400 lines plus tests.
- **Self-host parity.** Stock `postgres:18.6-alpine` works, so we drop pgmq, which needs the extension. CI is unchanged
  apart from starting the worker.
- **Midday's stack (BullMQ, Redis, Railway, custom dashboard)** solves a 12-domain problem with an always-on host. We
  copy their registry, classification, health, shutdown and dashboard patterns, not the infra.

**Explicitly not doing:**

- **Redis / BullMQ:** a second source of truth, and no worker on Hobby.
- **Vercel Queues:** beta, Vercel-only (breaks Docker parity), no DLQ, deployment-pinned topics.
- **Inngest / Trigger.dev:** they move execution to a vendor, and the free tiers are small.
- **pgmq + Edge Functions:** it would split the code into Deno.
- **Graphile Worker:** needs a session connection, and the OSS version locks crashed jobs for 4 h.
- **SSE.**
- **Partitioning.**
- **LISTEN/NOTIFY in v1.**
- **Copying Midday's AGPL code.**

**Change course when:**

| Trigger                                                                  | Move                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More than 5 job kinds, or real cron/RRULE needs, or flows/fan-in         | Swap the store to **pg-boss 12.x** behind the same `JobQueue` interface. Use `groupConcurrency` for fairness and its dashboard as a second view. Its tables live beside ours. |
| Sustained more than about 50 jobs/s, or claim p95 above 50 ms            | Partition `jobs`, add LISTEN on 5432, and run several workers. Past about 500 jobs/s, consider BullMQ as an execution layer, fed from a Postgres outbox.                      |
| Going commercial (Vercel Pro)                                            | Run `apps/worker` as a Daemon or on Railway and switch production to `JOBS_EXECUTION=worker`. Keep the drain route as the fallback.                                           |
| Multi-step receipts (multi-page PDF fan-out + merge, human review waits) | Evaluate DBOS Transact or Vercel Workflows for orchestration. Jobs stay the unit of execution.                                                                                |
| Drain-mode p95 queue wait above 2 min, or more than 1% of jobs reaped    | Move to a worker host now, without waiting for Pro.                                                                                                                           |

**Risks and mitigations:**

| Risk                                                                                    | Mitigation                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Our queue code has a subtle bug (double-run, lost job)                                  | Fencing on two levels: the job `locked_by` + state, and the receipt attempt guard. The concurrent-claimer, crash and late-settle integration tests are required in Track A. The SQL is small and reviewed once. |
| `pg_cron` / `pg_net` not enabled, or the secret wrong, so drains only happen on uploads | The admin "oldest waiting" alarm, the daily Vercel cron backstop, and a post-deploy check in `docs/deployment.md` (`select * from cron.job_run_details order by start_time desc limit 5`).                      |
| Supabase free project pauses on inactivity                                              | `pg_cron` traffic keeps it active. That only matters for a dormant project anyway.                                                                                                                              |
| Drain invocation killed mid-job (deploy, 300 s cap)                                     | The lease expires in 90 s. The reaper re-queues on the next tick. Attempts count, so poison jobs die.                                                                                                           |
| Gemini 429 storms burn attempts                                                         | `deferred` outcome on cooldown doesn't spend attempts. RPM windows cap calls before the 429 happens.                                                                                                            |
| Table bloat                                                                             | `fillfactor`, per-table autovacuum, batched retention. Watch `n_dead_tup` on the admin page.                                                                                                                    |
| Dropping instant mode feels slower                                                      | 1 s polling for the first 15 s, and the `after()` kick starts work immediately. Benchmark before/after with `bench/upload.k6.js` in Track B.                                                                    |

## Owner decisions needed

1. **Approve hand-rolled over pg-boss.** pg-boss is the recommended fallback, and the interface keeps the swap cheap.
2. **Drop instant mode**, so the upload always queues and the client polls.
3. **Enable `pg_cron` + `pg_net` on the production Supabase project** and store `jobs_drain_secret` in Vault.
   Production change, done by hand.
4. **Retry policy:** 4 automatic attempts (about 10 s / 20 s / 40 s), then dead. User "Try again" stays capped at 3
   rounds. Admin re-runs don't count toward quota.
5. **Per-owner running cap** default 2, and priorities (interactive 0, bulk 5).
6. **When to go commercial / Vercel Pro**, which decides the worker host: Vercel Daemon vs Railway. Railway is the
   lowest-risk option today.
7. **Update `AGENTS.md`** "Future jobs: BullMQ + Redis later" → "Postgres job queue (`packages/core/src/jobs`), worker
   in `apps/worker`; BullMQ only past the scale triggers".

## Sources

- Vercel: [cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing),
  [functions limits](https://vercel.com/docs/functions/limitations), [Queues](https://vercel.com/docs/queues),
  [Queues pricing](https://vercel.com/docs/queues/pricing), [Queues concepts](https://vercel.com/docs/queues/concepts),
  [background workers](https://vercel.com/docs/background-workers), [Daemons limits](https://vercel.com/docs/daemons/limits)
- Supabase: [Cron](https://supabase.com/docs/guides/cron), [Queues](https://supabase.com/docs/guides/queues)
- pg-boss: [repo](https://github.com/timgit/pg-boss), and the 12.38.0 tarball inspected (`notifier.js` falls back to
  polling under PgBouncer transaction pooling; `heartbeatSeconds`, `groupConcurrency`, `deadLetter`, policies;
  `adapters/drizzle.js`)
- Graphile Worker: [docs](https://worker.graphile.org/docs), [Pro recovery](https://worker.graphile.org/docs/pro/recovery)
- Upstash [QStash pricing](https://upstash.com/pricing/qstash), [Inngest pricing](https://www.inngest.com/pricing),
  [Trigger.dev pricing](https://trigger.dev/pricing)
- Midday: `midday-ai/midday` `apps/worker` (`src/index.ts`, `src/config.ts`, `src/queues/documents.config.ts`,
  `src/processors/{base,registry}.ts`, `src/schedulers/*`, `Dockerfile`, `railway.json`), `packages/{workbench,job-client,jobs}`. AGPL-3.0.
- npm registry (`npm view <pkg> time`), 2026-11-06.
