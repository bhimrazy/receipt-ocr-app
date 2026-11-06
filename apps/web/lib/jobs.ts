import "server-only";
import {
  JOB_REGISTRY,
  tick,
  type JobRunRecord,
  type ReceiptExtractResult,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { logger, type WideEvent } from "./log";
import { runtime } from "./runtime";

/**
 * In-process job execution, until a worker and a drain route exist: the
 * upload and retry routes run the queue themselves, in the request or in
 * `after()`. The job row is durable either way, so work cut short by a
 * deploy, a crash or the function's time limit is picked up by the next
 * request that runs the queue.
 */

/** Matches the routes' `maxDuration`, less room to log and return. */
export const ROUTE_BUDGET_MS = 290_000;

/** A claimed receipt job needs at most the OCR deadline (50 s) plus its writes. */
const STOP_CLAIMING_BEFORE_MS = 60_000;

/** Long enough for a receipt's own backoffs (about 10 s, 20 s, 40 s); later retries wait for the next run. */
const MAX_WAIT_MS = 90_000;

const workerId = () => `web:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

/** One wide event per job attempt. Ids, kinds and numbers only, never receipt contents. */
function logRun(run: JobRunRecord, context: WideEvent) {
  const result = run.result as ReceiptExtractResult | undefined;
  const event: WideEvent = {
    ...context,
    event: "job.run",
    job_id: run.jobId,
    kind: run.kind,
    receipt_id: run.receiptId,
    user_id: run.userId,
    attempt: run.attempt,
    max_attempts: run.maxAttempts,
    outcome: run.outcome,
    duration_ms: run.ms,
    ...(run.errorKind ? { error_kind: run.errorKind } : {}),
    ...(run.runAt ? { next_run_at: run.runAt.toISOString() } : {}),
  };
  if (result?.kind === "completed") {
    event.model = result.model;
    event.ocr = { attempts: result.attempts };
    event.cost_micro_usd = result.costMicroUsd;
    event.confidence = result.confidence;
    event.items_count = result.itemsCount;
  } else if (result?.kind === "skipped") {
    event.skipped = result.reason;
  }
  (run.outcome === "dead" || run.outcome === "lost" ? logger.error : logger.info)(event);
}

/**
 * Runs due jobs (anyone's) until nothing is runnable or `deadline` (epoch ms,
 * measured from the route's start) is near. Sleeps through backoff only for
 * `waitFor`, the jobs this request is responsible for, and for at most
 * MAX_WAIT_MS. For `after()`.
 */
export async function drainJobs(
  deadline: number,
  context: WideEvent,
  waitFor: readonly string[],
): Promise<void> {
  const budgetMs = deadline - Date.now();
  if (budgetMs <= STOP_CLAIMING_BEFORE_MS) return;
  const stats = await runtime.runPromise(
    tick({
      worker: workerId(),
      registry: JOB_REGISTRY,
      budgetMs,
      stopClaimingBeforeMs: STOP_CLAIMING_BEFORE_MS,
      waitForRetries: waitFor,
      maxWaitMs: MAX_WAIT_MS,
      onRun: (run) => logRun(run, context),
    }),
  );
  if (stats.reaped > 0) logger.info({ ...context, event: "job.reaped", count: stats.reaped });
}

/**
 * Runs one job now, in the request, if it can be claimed: the first attempt
 * of an upload the user is waiting on. Undefined when it couldn't be claimed
 * (the user is at the running cap, or the queue is paused).
 */
export const runJobNow = (jobId: string, context: WideEvent) =>
  tick({
    worker: workerId(),
    registry: JOB_REGISTRY,
    budgetMs: STOP_CLAIMING_BEFORE_MS + 1_000,
    stopClaimingBeforeMs: STOP_CLAIMING_BEFORE_MS,
    ids: [jobId],
    waitForRetries: false,
    onRun: (run) => logRun(run, context),
  }).pipe(Effect.map((stats) => stats.runs.find((run) => run.jobId === jobId)));
