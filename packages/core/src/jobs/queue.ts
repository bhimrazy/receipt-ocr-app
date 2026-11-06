import { jobs, sql, type SQL } from "@receipt-ocr/db";
import { Context, Effect, Layer } from "effect";
import type { Tx } from "../audit";
import type { DbError } from "../errors";
import { Db } from "../services";
import type { Queryable } from "../usage";
import type { Job, JobErrorKind, JobState, NewJob } from "./definition";

/**
 * The Postgres job store. Every statement is a single plain query or a
 * transaction: no LISTEN, no session advisory locks, no prepared statements,
 * so it all works through Supabase's transaction pooler.
 *
 * Fencing: after a claim, every write is `where id = $1 and locked_by =
 * $worker and attempts = $claimed and state = 'running'`. A worker whose
 * lease expired (even if the same worker id claimed the job again), or whose
 * job was cancelled, matches no row and changes nothing.
 */

export type EnqueueResult = { id: string } | { duplicate: true };

/**
 * Inserts a job with `db`, which may be an open transaction: the job commits
 * or rolls back with the rows it belongs to. A live job with the same
 * idempotency key (or, for receipt kinds, the same receipt) makes it a no-op.
 */
export async function enqueueJob(db: Pick<Tx, "insert">, job: NewJob): Promise<EnqueueResult> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind: job.kind,
      payload: job.payload,
      maxAttempts: job.maxAttempts,
      priority: job.priority ?? 0,
      idempotencyKey: job.idempotencyKey ?? null,
      receiptId: job.receiptId ?? null,
      organizationId: job.organizationId ?? null,
      userId: job.userId ?? null,
      ...(job.runAt ? { runAt: job.runAt } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return row ? { id: row.id } : { duplicate: true };
}

/** How a run ended, as recorded on the job. */
export type JobOutcome =
  | { type: "succeeded" }
  /**
   * Back to `queued` after `delayMs`; the attempt counts. Relative, so the
   * database's clock decides when it is due, not this process's.
   */
  | { type: "retry"; delayMs: number; errorKind: JobErrorKind }
  /** Back to `queued` at `at` without spending the attempt. */
  | { type: "deferred"; at: Date; errorKind: JobErrorKind }
  | { type: "dead"; errorKind: JobErrorKind };

export type ClaimInput = {
  worker: string;
  /** Kinds this worker runs, each with its lease. */
  kinds: readonly { kind: string; leaseSeconds: number }[];
  n: number;
  /** A user with this many running jobs gets no more until one finishes. */
  ownerCap: number;
  /** Only these jobs (e.g. the upload the request just made). */
  ids?: readonly string[];
};

const COLUMNS = sql.raw(`j.id, j.kind, j.state, j.priority, j.payload, j.idempotency_key,
  j.receipt_id, j.organization_id, j.user_id, j.attempts, j.max_attempts, j.run_at,
  j.locked_by, j.locked_until, j.last_error_kind`);

type RawJob = {
  id: string;
  kind: string;
  state: JobState;
  priority: number;
  payload: unknown;
  idempotency_key: string | null;
  receipt_id: string | null;
  organization_id: string | null;
  user_id: string | null;
  attempts: number;
  max_attempts: number;
  run_at: string | Date;
  locked_by: string | null;
  locked_until: string | Date | null;
  last_error_kind: string | null;
};

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));

const toJob = (row: RawJob): Job => ({
  id: row.id,
  kind: row.kind,
  state: row.state,
  priority: row.priority,
  payload: row.payload,
  idempotencyKey: row.idempotency_key,
  receiptId: row.receipt_id,
  organizationId: row.organization_id,
  userId: row.user_id,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  runAt: toDate(row.run_at),
  lockedBy: row.locked_by,
  lockedUntil: row.locked_until === null ? null : toDate(row.locked_until),
  lastErrorKind: row.last_error_kind,
});

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** `attempt_log` with `entry` appended, keeping the last five. */
const appendLog = (entry: SQL) => sql`(
  select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from (
    select e, i from jsonb_array_elements(j.attempt_log || ${entry}) with ordinality as t(e, i)
    order by i desc limit 5) s)`;

const logEntry = (outcome: string, errorKind: string | null) =>
  sql`jsonb_build_object('n', j.attempts, 'at', now(), 'outcome', ${outcome}::text,
    'kind', ${errorKind}::text, 'worker', j.locked_by,
    'ms', (extract(epoch from now() - j.started_at) * 1000)::int)`;

/** A pause (null `until`) or cooldown row that is in force now. */
const inForce = sql`(c.paused or c.until is not null) and (c.until is null or c.until > now())`;

async function rows(db: Queryable, query: SQL): Promise<Job[]> {
  return (await db.execute<RawJob>(query)).map(toJob);
}

export class JobQueue extends Context.Tag("@receipt-ocr/core/JobQueue")<
  JobQueue,
  {
    /** Enqueues outside any transaction; inside one, call `enqueueJob(tx, job)`. */
    readonly enqueue: (job: NewJob) => Effect.Effect<EnqueueResult, DbError>;
    /**
     * Claims up to `n` runnable jobs (`FOR UPDATE SKIP LOCKED`, so claimers
     * never wait on or double-claim each other), in priority then `run_at`
     * order, skipping paused kinds and users at the running cap.
     */
    readonly claim: (input: ClaimInput) => Effect.Effect<Job[], DbError>;
    /** Extends the lease; false when the job is no longer ours (reaped or cancelled). */
    readonly heartbeat: (
      job: Job,
      worker: string,
      leaseSeconds: number,
    ) => Effect.Effect<boolean, DbError>;
    /** Records how the run ended; false when the job is no longer ours, so nothing changed. */
    readonly settle: (
      job: Job,
      worker: string,
      outcome: JobOutcome,
    ) => Effect.Effect<boolean, DbError>;
    /**
     * Running jobs whose lease ran out (crash, deploy, killed function) go
     * back to queued, or to dead on their last attempt. Returns them.
     */
    readonly reap: (limit?: number) => Effect.Effect<Job[], DbError>;
    /** Cancels a queued or running job; returns it, or null when it had already finished. */
    readonly cancel: (id: string) => Effect.Effect<Job | null, DbError>;
    readonly get: (id: string) => Effect.Effect<Job | null, DbError>;
    /**
     * Milliseconds until the next queued job of these kinds is runnable, by
     * the database's clock (0 or less: due now); null when none is queued.
     */
    readonly nextRunIn: (
      kinds: readonly string[],
      ids?: readonly string[],
    ) => Effect.Effect<number | null, DbError>;
    /** Pauses `queue` or `kind:<kind>` until resumed (or until `until`). */
    readonly pause: (
      scope: string,
      input: { reason?: string; by?: string; until?: Date },
    ) => Effect.Effect<void, DbError>;
    readonly resume: (scope: string) => Effect.Effect<void, DbError>;
    /** Providers cooling down after a 429, keyed by provider id. */
    readonly cooldowns: Effect.Effect<Map<string, Date>, DbError>;
    /** Starts or extends `provider:<id>`'s cooldown by `ms` from now; never shortens one in force. */
    readonly coolDown: (provider: string, ms: number) => Effect.Effect<void, DbError>;
    /**
     * The receipt's job when it is due but nothing is running it: queued and
     * runnable, or running with an expired lease. Null otherwise.
     */
    readonly dueReceiptJob: (receiptId: string) => Effect.Effect<string | null, DbError>;
  }
>() {
  static readonly Live = Layer.effect(
    JobQueue,
    Effect.map(Db, ({ use }) => ({
      enqueue: (job) => use((db) => enqueueJob(db, job)),

      claim: ({ worker, kinds, n, ownerCap, ids }) =>
        kinds.length === 0 || n < 1 || ids?.length === 0
          ? Effect.succeed([])
          : use((db) => {
              const lease = sql`case j.kind ${sql.join(
                kinds.map((k) => sql`when ${k.kind} then ${k.leaseSeconds}::int`),
                sql` `,
              )} end`;
              return rows(
                db,
                sql`with stopped as (
                  select exists (select 1 from job_controls c where c.scope = 'queue' and ${inForce}) as yes
                ), running as (
                  select user_id, count(*) as n from jobs
                  where state = 'running' and user_id is not null
                  group by user_id
                ), candidates as (
                  -- Locks more than n, so the per-user cap below can skip
                  -- over one user's backlog; the extra locks end with this statement.
                  select j.id, j.user_id, j.priority, j.run_at from jobs j
                  where j.state = 'queued' and j.run_at <= now()
                    and j.kind in (${list(kinds.map((k) => k.kind))})
                    ${ids ? sql`and j.id in (${list(ids)})` : sql``}
                    and not (select yes from stopped)
                    and not exists (select 1 from job_controls c where c.scope = 'kind:' || j.kind and ${inForce})
                    and (j.user_id is null
                      or j.user_id not in (select user_id from running where n >= ${ownerCap}))
                  order by j.priority, j.run_at
                  limit ${n * 4}
                  for update of j skip locked
                ), picked as (
                  select id from (
                    select c.id, c.user_id, c.priority, c.run_at,
                      row_number() over (partition by c.user_id order by c.priority, c.run_at) as k,
                      coalesce((select r.n from running r where r.user_id = c.user_id), 0) as already
                    from candidates c) ranked
                  where user_id is null or already + k <= ${ownerCap}
                  order by priority, run_at
                  limit ${n}
                )
                update jobs j set state = 'running', attempts = j.attempts + 1, locked_by = ${worker},
                  locked_until = now() + make_interval(secs => ${lease}),
                  started_at = now(), updated_at = now()
                from picked where j.id = picked.id
                returning ${COLUMNS}`,
              );
            }),

      heartbeat: (job, worker, leaseSeconds) =>
        use(async (db) => {
          // Touches no indexed column, so it is a HOT update.
          const result = await db.execute(sql`update jobs
            set locked_until = now() + make_interval(secs => ${leaseSeconds}::int)
            where id = ${job.id} and locked_by = ${worker} and attempts = ${job.attempts}
              and state = 'running'
            returning id`);
          return result.length > 0;
        }),

      settle: (job, worker, outcome) =>
        use(async (db) => {
          const kind = outcome.type === "succeeded" ? null : outcome.errorKind;
          const set =
            outcome.type === "succeeded"
              ? sql`state = 'succeeded', finished_at = now()`
              : outcome.type === "dead"
                ? sql`state = 'dead', finished_at = now()`
                : outcome.type === "retry"
                  ? sql`state = 'queued', run_at = now() + make_interval(secs => ${outcome.delayMs / 1000}::float8)`
                  : sql`state = 'queued', run_at = ${ts(outcome.at)}, attempts = greatest(0, j.attempts - 1)`;
          const errorSet =
            kind === null ? sql`` : sql`, last_error_kind = ${kind}, last_error_at = now()`;
          const result = await db.execute(sql`update jobs j set ${set}${errorSet},
              attempt_log = ${appendLog(logEntry(outcome.type, kind))},
              locked_by = null, locked_until = null, updated_at = now()
            where j.id = ${job.id} and j.locked_by = ${worker} and j.attempts = ${job.attempts}
              and j.state = 'running'
            returning j.id`);
          return result.length > 0;
        }),

      reap: (limit = 100) =>
        use((db) =>
          rows(
            db,
            sql`update jobs j set
                state = case when j.attempts >= j.max_attempts then 'dead'::job_state else 'queued'::job_state end,
                finished_at = case when j.attempts >= j.max_attempts then now() end,
                run_at = now(), last_error_kind = 'lease-expired', last_error_at = now(),
                attempt_log = ${appendLog(logEntry("lease-expired", "lease-expired"))},
                locked_by = null, locked_until = null, updated_at = now()
              where j.id in (
                select id from jobs where state = 'running' and locked_until < now()
                order by locked_until limit ${limit}
                for update skip locked)
              returning ${COLUMNS}`,
          ),
        ),

      cancel: (id) =>
        use(async (db) => {
          const [job] = await rows(
            db,
            sql`update jobs j set state = 'cancelled', finished_at = now(),
                last_error_kind = 'cancelled', last_error_at = now(),
                locked_by = null, locked_until = null, updated_at = now()
              where j.id = ${id} and j.state in ('queued', 'running')
              returning ${COLUMNS}`,
          );
          return job ?? null;
        }),

      get: (id) =>
        use(async (db) => {
          const [job] = await rows(db, sql`select ${COLUMNS} from jobs j where j.id = ${id}`);
          return job ?? null;
        }),

      nextRunIn: (kinds, ids) =>
        kinds.length === 0 || ids?.length === 0
          ? Effect.succeed(null)
          : use(async (db) => {
              const [row] = await db.execute<{ ms: string | number | null }>(sql`
                select extract(epoch from min(run_at) - now()) * 1000 as ms from jobs j
                where j.state = 'queued' and j.kind in (${list(kinds)})
                  ${ids ? sql`and j.id in (${list(ids)})` : sql``}`);
              return row?.ms == null ? null : Number(row.ms);
            }),

      pause: (scope, input) =>
        use((db) =>
          db.execute(sql`insert into job_controls (scope, paused, until, reason, updated_by)
            values (${scope}, true, ${input.until ? ts(input.until) : null}, ${input.reason ?? null}, ${input.by ?? null})
            on conflict (scope) do update set paused = true, until = excluded.until,
              reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now()`),
        ).pipe(Effect.asVoid),

      resume: (scope) =>
        use((db) =>
          db.execute(sql`update job_controls set paused = false, until = null, updated_at = now()
            where scope = ${scope}`),
        ).pipe(Effect.asVoid),

      cooldowns: use(async (db) => {
        const result = await db.execute<{ scope: string; until: string | Date }>(sql`
          select scope, until from job_controls
          where scope like 'provider:%' and until > now()`);
        return new Map(result.map((r) => [r.scope.slice("provider:".length), toDate(r.until)]));
      }),

      coolDown: (provider, ms) =>
        use((db) =>
          db.execute(sql`insert into job_controls (scope, until, reason)
            values (${`provider:${provider}`}, now() + make_interval(secs => ${ms / 1000}::float8), 'rate-limited')
            on conflict (scope) do update
              set until = greatest(job_controls.until, excluded.until), updated_at = now()`),
        ).pipe(Effect.asVoid),

      dueReceiptJob: (receiptId) =>
        use(async (db) => {
          const [row] = await db.execute<{ id: string }>(sql`select j.id from jobs j
            where j.receipt_id = ${receiptId} and j.kind like 'receipt.%'
              and j.state in ('queued', 'running')
              and ((j.state = 'queued' and j.run_at <= now())
                or (j.state = 'running' and j.locked_until < now()))
            limit 1`);
          return row?.id ?? null;
        }),
    })),
  );
}
