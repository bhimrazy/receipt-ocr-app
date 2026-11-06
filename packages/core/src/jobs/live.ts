import { sql } from "@receipt-ocr/db";

/**
 * How long nothing may happen before a receipt job stops counting as live:
 * running with its lease expired this long (nothing reaped it), or queued
 * past its `run_at` this long while no tick has run anywhere for this long
 * (nothing is draining the queue at all). A job that is only waiting its turn
 * (a backlog, its owner at the running cap, a pause) stays live, because
 * ticks keep running. An orphaned job's receipt reads as failed and frees its
 * quota, and the user's retry cancels the job.
 */
export const STALE_AFTER_MS = 5 * 60_000;

/** `job_controls` row whose `updated_at` is the last time any process ran `tick`. */
export const TICK_SCOPE = "tick";

const overdue = sql.raw(`interval '${STALE_AFTER_MS / 1000} seconds'`);

/**
 * A receipt job that is queued or running and not orphaned (see above), as a
 * predicate over `alias`. The one definition of "live" for the stale rule,
 * the quota's in-flight rule and receipt lookups. It repeats the predicate of
 * `jobs_receipt_live_idx`, so lookups by receipt use that index.
 */
export const liveReceiptJob = (alias: string) => {
  const j = sql.raw(alias);
  return sql`(${j}.kind like 'receipt.%' and ${j}.state in ('queued', 'running')
    and ((${j}.state = 'queued' and (${j}.run_at >= now() - ${overdue}
        or exists (select 1 from job_controls t
          where t.scope = ${TICK_SCOPE} and t.updated_at >= now() - ${overdue})))
      or (${j}.state = 'running' and ${j}.locked_until >= now() - ${overdue})))`;
};
