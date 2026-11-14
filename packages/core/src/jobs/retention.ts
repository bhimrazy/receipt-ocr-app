import { and, inArray, jobs, sql, type SQL } from "@receipt-ocr/db";
import { Effect } from "effect";
import { Db } from "../services";
import { WELCOME_EMAIL } from "./kinds/welcome-email";

/** Covers the Operations page's longest range (30 days) and recent support questions. */
export const SUCCEEDED_JOB_RETENTION_DAYS = 30;
/** Dead and cancelled jobs are the ones an admin investigates or re-runs, so they stay longer. */
export const FAILED_JOB_RETENTION_DAYS = 90;

/**
 * Finished jobs past their retention. Idempotency keys only dedupe against live jobs, so deleting a
 * finished one frees nothing that wasn't free already. The exception is `enqueueWelcomeEmail`, which
 * reads finished welcome jobs to welcome a user once ever: those stay until the account is deleted
 * (which nulls `user_id`).
 */
const expired = (states: readonly string[], days: number): SQL =>
  sql`${jobs.state} in (${sql.join(
    states.map((s) => sql`${s}`),
    sql`, `,
  )}) and ${jobs.finishedAt} < now() - make_interval(days => ${days})
    and not (${jobs.kind} = ${WELCOME_EMAIL} and ${jobs.userId} is not null)`;

const EXPIRED = {
  succeeded: expired(["succeeded"], SUCCEEDED_JOB_RETENTION_DAYS),
  failed: expired(["dead", "cancelled"], FAILED_JOB_RETENTION_DAYS),
};

/**
 * Deletes up to `limit` finished jobs of one class past its retention and returns how many. The
 * delete repeats the predicate, so a job an admin re-ran meanwhile (queued again) is kept.
 */
export const purgeFinishedJobs = (which: keyof typeof EXPIRED, limit: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const predicate = EXPIRED[which];
      const ids = db.select({ id: jobs.id }).from(jobs).where(predicate).limit(limit);
      const deleted = await db
        .delete(jobs)
        .where(and(inArray(jobs.id, ids), predicate))
        .returning({ id: jobs.id });
      return deleted.length;
    }),
  );
