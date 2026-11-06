import { Cause, Clock, Duration, Effect, Exit, Option } from "effect";
import { backoffMs } from "./backoff";
import type { AnyJobDefinition, Job, JobErrorKind, JobFailure, JobRegistry } from "./definition";
import { JobQueue, type JobOutcome } from "./queue";

/** Default per-user running cap: one user's bulk import can't take every slot. */
export const DEFAULT_OWNER_CAP = 2;

/** Longest idle sleep before looking for new work again. */
const IDLE_POLL_MS = 5_000;

export type JobRunRecord = {
  jobId: string;
  kind: string;
  receiptId: string | null;
  userId: string | null;
  attempt: number;
  maxAttempts: number;
  /** `lost`: the lease was lost (reaped or cancelled) and the outcome wasn't ours to record. */
  outcome: JobOutcome["type"] | "lost";
  errorKind?: JobErrorKind;
  /** When a retry or deferral runs next. */
  runAt?: Date;
  ms: number;
  /** What the handler returned, for the caller's wide event. */
  result?: unknown;
};

export type TickOptions<R> = {
  worker: string;
  registry: JobRegistry<R>;
  /** Wall-clock budget for the whole tick. */
  budgetMs: number;
  /**
   * Stop claiming this long before the budget ends, so a claimed job can
   * finish (the OCR deadline plus the write). Default: a quarter of the budget.
   */
  stopClaimingBeforeMs?: number;
  /** Jobs run at once. Default 1. */
  concurrency?: number;
  ownerCap?: number;
  /** Only these jobs. */
  ids?: readonly string[];
  /**
   * Wait for queued jobs that become runnable before claiming stops (retries
   * in backoff). Off: return as soon as nothing is runnable now. Default on.
   */
  waitForRetries?: boolean;
  /** Called as each run ends, e.g. to log one wide event per attempt. */
  onRun?: (record: JobRunRecord) => void;
};

export type TickStats = { reaped: number; runs: JobRunRecord[] };

/**
 * Claims and runs jobs until nothing is runnable or the budget says stop. The
 * long-running worker calls it in a loop; a request or drain route calls it
 * once. Never fails: job failures are recorded on the job, and a database
 * outage ends the tick early (the jobs stay queued for the next one).
 */
export const tick = <R>(options: TickOptions<R>) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const start = yield* Clock.currentTimeMillis;
    const stopClaimingAt =
      start + options.budgetMs - (options.stopClaimingBeforeMs ?? options.budgetMs / 4);
    const definitions = Object.values(options.registry);
    const kinds = definitions.map((d) => ({ kind: d.kind, leaseSeconds: d.leaseSeconds }));
    const kindNames = kinds.map((k) => k.kind);
    const runs: JobRunRecord[] = [];
    const record = (run: JobRunRecord) => {
      runs.push(run);
      options.onRun?.(run);
    };

    const reaped = yield* queue.reap().pipe(
      Effect.tapError((error) => Effect.logError("jobs.reap_failed", { error: error.message })),
      Effect.orElseSucceed((): Job[] => []),
    );
    for (const job of reaped) {
      if (job.state === "dead")
        yield* finalFailure(options.registry[job.kind], job, "lease-expired");
    }

    const slot = Effect.gen(function* () {
      while ((yield* Clock.currentTimeMillis) < stopClaimingAt) {
        const [job] = yield* queue.claim({
          worker: options.worker,
          kinds,
          n: 1,
          ownerCap: options.ownerCap ?? DEFAULT_OWNER_CAP,
          ids: options.ids,
        });
        if (job) {
          record(yield* runClaimed(options.registry, job, options.worker));
          continue;
        }
        if (options.waitForRetries === false) return;
        const waitMs = yield* queue.nextRunIn(kindNames, options.ids);
        const now = yield* Clock.currentTimeMillis;
        // Nothing queued, nothing due before claiming stops, or something due
        // that we may not claim (paused, user at the cap, another worker has it).
        if (waitMs === null || waitMs <= 0 || now + waitMs >= stopClaimingAt) return;
        yield* Effect.sleep(Duration.millis(Math.min(waitMs, IDLE_POLL_MS)));
      }
    }).pipe(
      Effect.catchAll((error) => Effect.logError("jobs.tick_failed", { error: error.message })),
    );

    yield* Effect.all(
      Array.from({ length: Math.max(1, options.concurrency ?? 1) }, () => slot),
      { concurrency: "unbounded", discard: true },
    );
    return { reaped: reaped.length, runs } satisfies TickStats;
  });

/** Runs one claimed job to an outcome, holding its lease with heartbeats meanwhile. */
const runClaimed = <R>(registry: JobRegistry<R>, job: Job, worker: string) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const startedAt = yield* Clock.currentTimeMillis;
    const base = {
      jobId: job.id,
      kind: job.kind,
      receiptId: job.receiptId,
      userId: job.userId,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    };
    const finish = (outcome: JobOutcome) =>
      Effect.gen(function* () {
        const settled = yield* queue.settle(job, worker, outcome).pipe(
          Effect.tapError((error) =>
            Effect.logError("jobs.settle_failed", { jobId: job.id, error: error.message }),
          ),
          // Unrecorded: the lease runs out and the reaper re-queues the job.
          Effect.orElseSucceed(() => false),
        );
        const ms = (yield* Clock.currentTimeMillis) - startedAt;
        const errorKind = outcome.type === "succeeded" ? undefined : outcome.errorKind;
        const runAt =
          outcome.type === "retry"
            ? new Date(startedAt + ms + outcome.delayMs)
            : outcome.type === "deferred"
              ? outcome.at
              : undefined;
        return { settled, ms, errorKind, runAt };
      });

    const definition = registry[job.kind];
    const parsed = definition?.payload.safeParse(job.payload);
    if (!definition || !parsed?.success) {
      const errorKind = definition ? "invalid-payload" : "unknown-kind";
      const done = yield* finish({ type: "dead", errorKind });
      return { ...base, outcome: done.settled ? "dead" : "lost", errorKind, ms: done.ms } as const;
    }

    const exit = yield* definition
      .run(parsed.data, { job, attempt: job.attempts, worker })
      .pipe(
        Effect.exit,
        Effect.raceFirst(
          leaseWatch(job, worker, definition.leaseSeconds).pipe(Effect.as("lost" as const)),
        ),
      );
    if (exit === "lost") {
      const ms = (yield* Clock.currentTimeMillis) - startedAt;
      return { ...base, outcome: "lost", errorKind: "lease-lost", ms } satisfies JobRunRecord;
    }

    const outcome = yield* decide(definition, job, exit);
    const done = yield* finish(outcome);
    if (done.settled && outcome.type === "dead") {
      yield* finalFailure(definition, { ...job, state: "dead" }, outcome.errorKind);
    }
    return {
      ...base,
      outcome: done.settled ? outcome.type : "lost",
      ms: done.ms,
      ...(done.errorKind ? { errorKind: done.errorKind } : {}),
      ...(done.runAt ? { runAt: done.runAt } : {}),
      ...(Exit.isSuccess(exit) ? { result: exit.value } : {}),
    } satisfies JobRunRecord;
  });

/** What a run's exit means for the job: done, try again later, wait, or give up. */
const decide = <R>(
  definition: AnyJobDefinition<R>,
  job: Job,
  exit: Exit.Exit<unknown, JobFailure>,
) =>
  Effect.gen(function* () {
    if (Exit.isSuccess(exit)) return { type: "succeeded" } as JobOutcome;
    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) {
      // A defect (a bug, or an interruption we didn't ask for): retry, so a
      // poison job still dies after its attempts.
      yield* Effect.logError("jobs.defect", {
        jobId: job.id,
        kind: job.kind,
        cause: Cause.pretty(exit.cause).slice(0, 500),
      });
      return retryOrDead(definition, job, "internal", undefined);
    }
    const error = failure.value;
    switch (error._tag) {
      case "JobDeferred":
        return { type: "deferred", at: error.until, errorKind: error.kind } as JobOutcome;
      case "RetryableJobError":
        return retryOrDead(definition, job, error.kind, error.retryAfterMs);
      case "NonRetryableJobError":
        return { type: "dead", errorKind: error.kind } as JobOutcome;
    }
  });

const retryOrDead = <R>(
  definition: AnyJobDefinition<R>,
  job: Job,
  errorKind: JobErrorKind,
  retryAfterMs: number | undefined,
): JobOutcome =>
  job.attempts >= job.maxAttempts
    ? { type: "dead", errorKind }
    : {
        type: "retry",
        errorKind,
        delayMs: backoffMs(job.attempts, definition.backoff, retryAfterMs),
      };

/**
 * Renews the lease every third of it. Completes only when the lease is lost:
 * the job was reaped or cancelled, or heartbeats kept failing for a whole
 * lease. Racing it against the handler interrupts the handler (its AbortSignal
 * stops the model call).
 */
const leaseWatch = (job: Job, worker: string, leaseSeconds: number) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const everyMs = (leaseSeconds * 1000) / 3;
    let failingSince: number | null = null;
    while (true) {
      yield* Effect.sleep(Duration.millis(everyMs));
      const beat = yield* Effect.either(queue.heartbeat(job, worker, leaseSeconds));
      const now = yield* Clock.currentTimeMillis;
      if (beat._tag === "Right") {
        if (!beat.right) return;
        failingSince = null;
        continue;
      }
      failingSince ??= now - everyMs;
      if (now - failingSince >= leaseSeconds * 1000) return;
    }
  });

/** The kind's final-failure hook, for a job that just went dead or was cancelled. */
const finalFailure = <R>(
  definition: AnyJobDefinition<R> | undefined,
  job: Job,
  errorKind: JobErrorKind,
) =>
  Effect.gen(function* () {
    const parsed = definition?.payload.safeParse(job.payload);
    if (!definition?.onFinalFailure || !parsed?.success) return;
    yield* definition.onFinalFailure(parsed.data, { job, errorKind });
  });

/** Cancels a queued or running job and settles what it was for. False when it had already finished. */
export const cancelJob = <R>(registry: JobRegistry<R>, id: string) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const job = yield* queue.cancel(id);
    if (!job) return false;
    yield* finalFailure(registry[job.kind], job, "cancelled");
    return true;
  });
