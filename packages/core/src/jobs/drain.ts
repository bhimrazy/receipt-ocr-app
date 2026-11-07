import { Clock, Effect } from "effect";
import type { WideEventFields } from "../telemetry/schema";
import type { JobRegistry } from "./definition";
import { tick, type JobRunRecord, type TickStats } from "./runner";

export type DrainOptions<R> = {
  registry: JobRegistry<R>;
  /** Names the process in events and job locks: `web:<pid>:<id>`, `worker:<host>`. */
  worker: string;
  /** What started this drain: `drain` for the HTTP route, `worker` for the loop. */
  trigger: string;
  /** Wall-clock budget for the whole call, claimed jobs' run time included. */
  budgetMs: number;
  /** Stop claiming this long before the budget ends, so a claimed job can finish. */
  stopClaimingBeforeMs?: number;
  /** Claim at most this many jobs. */
  maxJobs: number;
  /** Jobs run at once. Default 1. */
  concurrency?: number;
  /** Copied onto the events the drain writes (the request id). */
  context?: WideEventFields;
};

/** Counts only, so a caller can return or log it freely. */
export type DrainSummary = {
  claimed: number;
  succeeded: number;
  retried: number;
  deferred: number;
  dead: number;
  lost: number;
  reaped: number;
  /** The job cap ended the drain: more may be waiting. */
  capped: boolean;
  ms: number;
};

const summarize = (
  stats: TickStats,
  options: Pick<DrainOptions<unknown>, "maxJobs">,
  ms: number,
): DrainSummary => {
  const count = (outcome: JobRunRecord["outcome"]) =>
    stats.runs.filter((run) => run.outcome === outcome).length;
  return {
    claimed: stats.runs.length,
    succeeded: count("succeeded"),
    retried: count("retry"),
    deferred: count("deferred"),
    dead: count("dead"),
    lost: count("lost"),
    reaped: stats.reaped,
    capped: stats.runs.length >= options.maxJobs,
    ms,
  };
};

/**
 * One bounded pass over the queue: reaps expired leases, then claims and runs
 * due jobs (anyone's) until nothing is due, `maxJobs` were claimed or the
 * budget says stop. Never sleeps for a retry's backoff; that job waits for
 * the next pass. Free of any HTTP or framework type, so a cron route and a
 * long-running worker call the same function. Concurrent calls are safe: the
 * claim is `FOR UPDATE SKIP LOCKED`, so no two passes run one job.
 */
export const drainOnce = <R>(options: DrainOptions<R>) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const stats = yield* tick({
      worker: options.worker,
      registry: options.registry,
      budgetMs: options.budgetMs,
      stopClaimingBeforeMs: options.stopClaimingBeforeMs,
      concurrency: options.concurrency,
      maxJobs: options.maxJobs,
      waitForRetries: false,
      context: { ...options.context, trigger: options.trigger },
    });
    return summarize(stats, options, (yield* Clock.currentTimeMillis) - started);
  });

export type WorkerLoopOptions<R> = Omit<DrainOptions<R>, "trigger"> & {
  /** Stops the loop: the pass in progress finishes, then it returns. */
  signal: AbortSignal;
  /** Sleep after a pass that did nothing. */
  idleMs: number;
  /** Called after every pass that did something. */
  onPass?: (summary: DrainSummary) => void;
};

const wasIdle = (summary: DrainSummary) => summary.claimed === 0 && summary.reaped === 0;

/**
 * The future `apps/worker`: passes back to back while there is work, a sleep
 * of `idleMs` when there is none. Returns after `signal` aborts, once the pass
 * in progress has finished, so a claimed job is never abandoned mid-run.
 */
export const runWorkerLoop = <R>(options: WorkerLoopOptions<R>) =>
  Effect.gen(function* () {
    const { signal, idleMs, onPass, ...drain } = options;
    while (!signal.aborted) {
      const summary = yield* drainOnce({ ...drain, trigger: "worker" });
      if (!wasIdle(summary)) onPass?.(summary);
      else if (!signal.aborted) yield* sleepUnlessAborted(signal, idleMs);
    }
  });

const sleepUnlessAborted = (signal: AbortSignal, ms: number) =>
  Effect.async<void>((resume) => {
    const done = () => resume(Effect.void);
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    return Effect.sync(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
    });
  });
