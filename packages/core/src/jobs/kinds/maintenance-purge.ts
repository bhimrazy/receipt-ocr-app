import { Effect } from "effect";
import { z } from "zod";
import { Db } from "../../services";
import { purgeSupportMessages } from "../../support";
import { annotateEvent } from "../../telemetry/current";
import { logger } from "../../telemetry/logger";
import { errorFields } from "../../telemetry/redact";
import { RetryableJobError, type JobDefinition, type NewJob } from "../definition";
import { enqueueJob } from "../queue";

export const MAINTENANCE_PURGE = "maintenance.purge";
const MAINTENANCE_PURGE_MAX_ATTEMPTS = 5;

/** Rows per delete statement, so each stays far below the statement timeout. */
export const PURGE_BATCH = 500;
/** Batches per run. Anything left waits for the next day's run. */
const PURGE_MAX_BATCHES = 20;

const maintenancePurgePayload = z.object({});
type MaintenancePurgePayload = z.infer<typeof maintenancePurgePayload>;

/**
 * Tomorrow's run, due at 00:00 UTC and keyed by that day. The key dedupes only against a live job,
 * so keying by tomorrow (not today) is what stops a drain from queueing a second run on the day
 * the first one finished.
 */
export const maintenancePurgeJob = (now: Date): NewJob => {
  const runAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return {
    kind: MAINTENANCE_PURGE,
    payload: {} satisfies MaintenancePurgePayload,
    maxAttempts: MAINTENANCE_PURGE_MAX_ATTEMPTS,
    priority: 9,
    idempotencyKey: `${MAINTENANCE_PURGE}:${runAt.toISOString().slice(0, 10)}`,
    runAt,
  };
};

/**
 * Queues tomorrow's purge unless it is already queued: one insert that conflicts away on every
 * drain but the first of the day. A failure is logged and never fails the caller's drain.
 */
export const scheduleMaintenance = (now: Date = new Date()) =>
  Effect.flatMap(Db, ({ use }) => use((db) => enqueueJob(db, maintenancePurgeJob(now)))).pipe(
    Effect.asVoid,
    Effect.catchAll((error) =>
      Effect.sync(() =>
        logger.error({ event: "jobs.schedule_failed", unit: "log", error: errorFields(error) }),
      ),
    ),
  );

/** Deletes data past its retention period, in batches; a retry after a partial run is safe. */
export const maintenancePurge: JobDefinition<MaintenancePurgePayload, Db> = {
  kind: MAINTENANCE_PURGE,
  payload: maintenancePurgePayload,
  maxAttempts: MAINTENANCE_PURGE_MAX_ATTEMPTS,
  leaseSeconds: 120,
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: () =>
    Effect.gen(function* () {
      let supportMessages = 0;
      for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
        const deleted = yield* purgeSupportMessages(PURGE_BATCH);
        supportMessages += deleted;
        if (deleted < PURGE_BATCH) break;
      }
      yield* annotateEvent({ count: supportMessages });
      return { supportMessages };
    }).pipe(
      Effect.catchTag("DbError", (error) =>
        Effect.zipRight(
          annotateEvent({ error: errorFields(error) }),
          Effect.fail(new RetryableJobError({ kind: "db-error" })),
        ),
      ),
    ),
};
