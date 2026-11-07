import "server-only";
import { JOB_REGISTRY, tick, type WideEventFields } from "@receipt-ocr/core";
import { Effect } from "effect";
import { runtime } from "./runtime";

/**
 * In-process job execution, until a worker and a drain route exist: the
 * upload and retry routes run the queue themselves, in the request or in
 * `after()`. The job row is durable either way, so work cut short by a
 * deploy, a crash or the function's time limit is picked up by the next
 * request that runs the queue.
 *
 * The runner writes the events: one `job.attempt` per attempt and a
 * `job.tick` summary per drain. `context` (the request id and the trigger)
 * is copied onto them, so a request's jobs can be found by its id.
 */

/** Matches the routes' `maxDuration`, less room to log and return. */
export const ROUTE_BUDGET_MS = 290_000;

/** A claimed receipt job needs at most the OCR deadline (50 s) plus its writes. */
const STOP_CLAIMING_BEFORE_MS = 60_000;

/** Long enough for a receipt's own backoffs (about 10 s, 20 s, 40 s); later retries wait for the next run. */
const MAX_WAIT_MS = 90_000;

const workerId = () => `web:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

/**
 * Runs due jobs (anyone's) until nothing is runnable or `deadline` (epoch ms,
 * measured from the route's start) is near. Sleeps through backoff only for
 * `waitFor`, the jobs this request is responsible for, and for at most
 * MAX_WAIT_MS. For `after()`.
 */
export async function drainJobs(
  deadline: number,
  context: WideEventFields,
  waitFor: readonly string[],
): Promise<void> {
  const budgetMs = deadline - Date.now();
  if (budgetMs <= STOP_CLAIMING_BEFORE_MS) return;
  await runtime.runPromise(
    tick({
      worker: workerId(),
      registry: JOB_REGISTRY,
      budgetMs,
      stopClaimingBeforeMs: STOP_CLAIMING_BEFORE_MS,
      waitForRetries: waitFor,
      maxWaitMs: MAX_WAIT_MS,
      context,
    }),
  );
}

/**
 * Runs one job now, in the request, if it can be claimed: the first attempt
 * of an upload the user is waiting on. Undefined when it couldn't be claimed
 * (the user is at the running cap, or the queue is paused).
 */
export const runJobNow = (jobId: string, context: WideEventFields) =>
  tick({
    worker: workerId(),
    registry: JOB_REGISTRY,
    budgetMs: STOP_CLAIMING_BEFORE_MS + 1_000,
    stopClaimingBeforeMs: STOP_CLAIMING_BEFORE_MS,
    ids: [jobId],
    waitForRetries: false,
    context,
  }).pipe(Effect.map((stats) => stats.runs.find((run) => run.jobId === jobId)));

/**
 * For `after()` of a poll that found the receipt's job due and nobody running
 * it: runs that one job, or returns at once if it can't be claimed. Never
 * other jobs, so poll traffic doesn't become queue concurrency.
 */
export async function kickJob(jobId: string, context: WideEventFields): Promise<void> {
  await runtime.runPromise(runJobNow(jobId, context));
}
