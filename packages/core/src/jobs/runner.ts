import { Cause, Clock, Duration, Effect, Exit, Option } from "effect";
import { backoffMs } from "./backoff";
import type { AnyJobDefinition, Job, JobErrorKind, JobFailure, JobRegistry } from "./definition";
import { DEFAULT_OWNER_CAP, JobQueue, type JobOutcome } from "./queue";
import { annotateEvent, mergeFields, withWideEvent } from "../telemetry/current";
import { emitEvent } from "../telemetry/logger";
import { errorFields } from "../telemetry/redact";
import type { WideEvent, WideEventFields } from "../telemetry/schema";

/**
 * How often one process records, per kind, that it ticked: often enough for
 * the 5-minute orphan rule, rare enough not to be a hot write.
 */
const MARK_TICK_EVERY_MS = 30_000;
const lastTickMark = new Map<string, number>();

/** Forgets this process's tick marks, so the next tick writes them (tests). */
export const resetTickMarks = () => lastTickMark.clear();

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
   * When nothing is runnable, sleep until a queued job becomes runnable
   * (retries in backoff) before claiming stops: `true` for any job, a list to
   * wait only for those (a request waits for its own job, not the whole
   * queue's). `false`: return at once. Default `true`.
   */
  waitForRetries?: boolean | readonly string[];
  /** Never sleep for a job due later than this long after the tick started. Default: no cap. */
  maxWaitMs?: number;
  /** Called as each run ends, after its `job.attempt` event is written. */
  onRun?: (record: JobRunRecord) => void;
  /**
   * Copied onto every event the tick writes: the id of the request that
   * started it and the trigger (`upload`, `retry`, `poll`).
   */
  context?: WideEventFields;
};

export type TickStats = { reaped: number; runs: JobRunRecord[] };

/**
 * Claims and runs jobs until nothing is runnable or the budget says stop. The
 * long-running worker calls it in a loop; a request or drain route calls it
 * once. Never fails: job failures are recorded on the job, and a database
 * outage ends the tick early (the jobs stay queued for the next one).
 *
 * Each attempt writes one `job.attempt` event. A tick that can claim any job
 * (not one filtered to a few ids), or that reaped or hit a problem, also
 * writes one `job.tick` summary; an idle one is routine and sampled.
 */
export const tick = <R>(options: TickOptions<R>) =>
  Effect.gen(function* () {
    const tickEvent: WideEvent = {
      ...options.context,
      event: "job.tick",
      unit: "job_tick",
      worker: options.worker,
    };
    const tickStart = yield* Clock.currentTimeMillis;
    const stats = yield* runTick(options).pipe(withWideEvent(tickEvent));
    const count = (outcome: JobRunRecord["outcome"]) =>
      stats.runs.filter((run) => run.outcome === outcome).length;
    const idle = stats.runs.length === 0 && stats.reaped === 0;
    mergeFields(tickEvent, {
      duration_ms: (yield* Clock.currentTimeMillis) - tickStart,
      outcome: idle ? "idle" : "ran",
      tick: {
        claimed: stats.runs.length,
        succeeded: count("succeeded"),
        retried: count("retry"),
        deferred: count("deferred"),
        dead: count("dead"),
        lost: count("lost"),
        reaped: stats.reaped,
        reaped_dead: stats.reapedDead,
        idle,
      },
    });
    if (!options.ids || stats.reaped > 0 || tickEvent.notices) {
      yield* emitEvent(tickEvent, { routine: idle && !tickEvent.notices });
    }
    return { reaped: stats.reaped, runs: stats.runs } satisfies TickStats;
  });

const runTick = <R>(options: TickOptions<R>) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const definitions = Object.values(options.registry);
    const kinds = definitions.map((d) => ({ kind: d.kind, leaseSeconds: d.leaseSeconds }));
    const kindNames = kinds.map((k) => k.kind);
    const runs: JobRunRecord[] = [];
    const record = (run: JobRunRecord) => {
      runs.push(run);
      options.onRun?.(run);
    };

    // Only a tick that can claim any job of a kind proves that kind is being
    // drained; one filtered to a few ids (a request running its own job) doesn't.
    if (!options.ids) {
      const beganAt = yield* Clock.currentTimeMillis;
      const due = kindNames.filter(
        (kind) => beganAt - (lastTickMark.get(kind) ?? -Infinity) >= MARK_TICK_EVERY_MS,
      );
      for (const kind of due) lastTickMark.set(kind, beganAt);
      yield* queue.markTick(due).pipe(Effect.ignore);
    }
    const reaped = yield* queue.reap().pipe(
      Effect.tapError((error) =>
        Effect.zipRight(
          annotateEvent({ error: errorFields(error) }),
          Effect.logError("jobs.reap_failed"),
        ),
      ),
      Effect.orElseSucceed((): Job[] => []),
    );
    for (const job of reaped) {
      if (job.state === "dead")
        yield* finalFailure(options.registry[job.kind], job, "lease-expired");
    }
    // After the reap, so a slow one can't eat the claim window.
    const start = yield* Clock.currentTimeMillis;
    const stopClaimingAt =
      start + options.budgetMs - (options.stopClaimingBeforeMs ?? options.budgetMs / 4);
    const waitUntil = Math.min(stopClaimingAt, start + (options.maxWaitMs ?? Infinity));
    const waitFor = options.waitForRetries ?? true;

    const slot = Effect.gen(function* () {
      let dueAfterEmptyClaim = false;
      while ((yield* Clock.currentTimeMillis) < stopClaimingAt) {
        const [job] = yield* queue.claim({
          worker: options.worker,
          kinds,
          n: 1,
          ownerCap: options.ownerCap ?? DEFAULT_OWNER_CAP,
          ids: options.ids,
        });
        if (job) {
          dueAfterEmptyClaim = false;
          record(yield* runClaimed(options.registry, job, options.worker, options.context));
          continue;
        }
        if (waitFor === false) return;
        const waitMs = yield* queue.nextRunIn(kindNames, waitFor === true ? options.ids : waitFor);
        const now = yield* Clock.currentTimeMillis;
        if (waitMs === null || now + waitMs >= waitUntil) return;
        if (waitMs <= 0) {
          // Due now. It may have become due just after the empty claim, so
          // claim once more; due twice in a row and still unclaimed means it
          // isn't ours (paused, its user at the cap, another worker has it).
          if (dueAfterEmptyClaim) return;
          dueAfterEmptyClaim = true;
          continue;
        }
        dueAfterEmptyClaim = false;
        yield* Effect.sleep(Duration.millis(Math.min(waitMs, IDLE_POLL_MS)));
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.zipRight(
          annotateEvent({ error: errorFields(error) }),
          Effect.logError("jobs.tick_failed"),
        ),
      ),
    );

    yield* Effect.all(
      Array.from({ length: Math.max(1, options.concurrency ?? 1) }, () => slot),
      { concurrency: "unbounded", discard: true },
    );
    return {
      reaped: reaped.length,
      reapedDead: reaped.filter((job) => job.state === "dead").length,
      runs,
    };
  });

/** Runs one claimed job and writes its `job.attempt` event, from claim to settle. */
const runClaimed = <R>(
  registry: JobRegistry<R>,
  job: Job,
  worker: string,
  context: WideEventFields | undefined,
) =>
  Effect.gen(function* () {
    const event: WideEvent = {
      ...context,
      event: "job.attempt",
      unit: "job_attempt",
      job_id: job.id,
      receipt_id: job.receiptId,
      user_id: job.userId,
      organization_id: job.organizationId,
      attempt: job.attempts,
      max_attempts: job.maxAttempts,
      worker,
      queue: { kind: job.kind, priority: job.priority, wait_ms: job.waitMs },
    };
    const run: JobRunRecord = yield* attempt(registry, job, worker).pipe(withWideEvent(event));
    const now = yield* Clock.currentTimeMillis;
    mergeFields(event, {
      duration_ms: run.ms,
      outcome: run.outcome,
      queue: {
        outcome: run.outcome,
        error_kind: run.errorKind,
        next_run_in_ms: run.runAt ? Math.max(0, run.runAt.getTime() - now) : undefined,
      },
    });
    if (run.errorKind) mergeFields(event, { error: { kind: event.error?.kind ?? run.errorKind } });
    yield* emitEvent(event);
    return run;
  });

/** Runs one claimed job to an outcome, holding its lease with heartbeats meanwhile. */
const attempt = <R>(registry: JobRegistry<R>, job: Job, worker: string) =>
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
          Effect.tapError(() => Effect.logError("jobs.settle_failed")),
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
      // The error's class only: its message or stack can hold receipt contents.
      yield* annotateEvent({
        level: "error",
        error: { ...errorFields(Cause.squash(exit.cause)), type: "Defect" },
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
