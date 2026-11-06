import { sql } from "@receipt-ocr/db";

/**
 * How long past due a receipt job may sit before it stops counting as live:
 * queued with `run_at` this far in the past (nothing ran the queue), or
 * running with its lease expired this long (nothing reaped it). Its receipt
 * then reads as failed, frees its quota, and the user's retry cancels the job.
 */
export const STALE_AFTER_MS = 5 * 60_000;

const overdue = sql.raw(`interval '${STALE_AFTER_MS / 1000} seconds'`);

/**
 * A receipt job that is queued or running and not long overdue, as a
 * predicate over `alias`. The one definition of "live" for the stale rule,
 * the quota's in-flight rule and receipt lookups. It repeats the predicate of
 * `jobs_receipt_live_idx`, so lookups by receipt use that index.
 */
export const liveReceiptJob = (alias: string) => {
  const j = sql.raw(alias);
  return sql`(${j}.kind like 'receipt.%' and ${j}.state in ('queued', 'running')
    and ((${j}.state = 'queued' and ${j}.run_at >= now() - ${overdue})
      or (${j}.state = 'running' and ${j}.locked_until >= now() - ${overdue})))`;
};
