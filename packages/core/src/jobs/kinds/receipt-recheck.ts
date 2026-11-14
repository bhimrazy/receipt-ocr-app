import { sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import { z } from "zod";
import { recheckBatch } from "../../recheck";
import { Db } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { logger } from "../../telemetry/logger";
import { errorFields } from "../../telemetry/redact";
import { RetryableJobError, type JobDefinition, type NewJob } from "../definition";
import { enqueueJob } from "../queue";

/**
 * Recomputes every completed receipt's review reasons (`recheck.ts`). Not a per-receipt read: its
 * jobs carry no `receipt_id`, so the one-live-job-per-receipt rule doesn't apply.
 */
export const RECEIPT_RECHECK = "receipt.recheck";
const MAX_ATTEMPTS = 5;

/** Change it with any change to the checks, so the next deploy rechecks every receipt once. */
export const RECHECK_VERSION = "2026-11-14";

/** Batches per run; the rest continue in a follow-up job, so one run stays well inside a drain. */
const MAX_BATCHES = 10;

const payload = z.object({
  version: z.string().min(1).max(40),
  after: z.uuid().optional(),
});
type RecheckPayload = z.infer<typeof payload>;

const key = (version: string, after?: string) =>
  after ? `${RECEIPT_RECHECK}:${version}:${after}` : `${RECEIPT_RECHECK}:${version}`;

export const receiptRecheckJob = (version: string, after?: string): NewJob => ({
  kind: RECEIPT_RECHECK,
  payload: { version, ...(after ? { after } : {}) } satisfies RecheckPayload,
  maxAttempts: MAX_ATTEMPTS,
  priority: 9,
  idempotencyKey: key(version, after),
});

let scheduled = false;

/**
 * Queues the recheck for RECHECK_VERSION unless a job for it was ever queued, so each version runs
 * once. Checked once per process: the first drain after a deploy. A failure is logged, never fails
 * the caller's drain, and is tried again on the next one.
 */
export const scheduleRecheck = () =>
  scheduled
    ? Effect.void
    : Effect.flatMap(Db, ({ use }) =>
        use(async (db) => {
          const job = receiptRecheckJob(RECHECK_VERSION);
          await db.execute(sql`
            insert into jobs (kind, payload, max_attempts, priority, idempotency_key)
            select ${job.kind}, ${JSON.stringify(job.payload)}::jsonb, ${job.maxAttempts}, ${job.priority ?? 0}, ${job.idempotencyKey}
            where not exists (select 1 from jobs where kind = ${job.kind} and idempotency_key = ${job.idempotencyKey})
            on conflict do nothing`);
          scheduled = true;
        }),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() =>
            logger.error({ event: "jobs.schedule_failed", unit: "log", error: errorFields(error) }),
          ),
        ),
      );

/** For tests: the next `scheduleRecheck` checks the database again. */
export const resetRecheckSchedule = () => {
  scheduled = false;
};

export const receiptRecheck: JobDefinition<RecheckPayload, Db> = {
  kind: RECEIPT_RECHECK,
  payload,
  maxAttempts: MAX_ATTEMPTS,
  leaseSeconds: 120,
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: ({ version, after }) =>
    Effect.gen(function* () {
      const { use } = yield* Db;
      let cursor: string | null = after ?? null;
      let scanned = 0;
      let changed = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const result: Awaited<ReturnType<typeof recheckBatch>> = yield* use((db) =>
          recheckBatch(db, cursor),
        );
        scanned += result.scanned;
        changed += result.changed;
        cursor = result.last;
        if (cursor === null) break;
      }
      // A retry of this run starts again from `after`: a batch already written changes nothing.
      if (cursor !== null) {
        const next = cursor;
        yield* use((db) => enqueueJob(db, receiptRecheckJob(version, next)));
      }
      yield* annotateEvent({ counts: { scanned, changed } });
      return { scanned, changed, more: cursor !== null };
    }).pipe(
      Effect.catchTag("DbError", (error) =>
        Effect.zipRight(
          annotateEvent({ error: errorFields(error) }),
          Effect.fail(new RetryableJobError({ kind: "db-error" })),
        ),
      ),
    ),
};
