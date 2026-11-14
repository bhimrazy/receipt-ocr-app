import { sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import { z } from "zod";
import { Db, Storage } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { logger } from "../../telemetry/logger";
import { errorFields } from "../../telemetry/redact";
import {
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type NewJob,
} from "../definition";
import { enqueueJob } from "../queue";

/**
 * Fills `receipts.file_bytes` for receipts stored before uploads recorded it, from each object's
 * size (a HEAD, nothing downloaded), so the storage cap counts them. A receipt whose object is
 * missing stays null (counted as 0) and is reported in `counts.missing`. Like `receipt.recheck`,
 * its jobs carry no `receipt_id`.
 */
export const RECEIPT_FILE_SIZE_BACKFILL = "receipt.file_size_backfill";
const MAX_ATTEMPTS = 5;

/** Receipts per batch, and HEAD requests in flight at once. */
export const BACKFILL_BATCH = 100;
const CONCURRENCY = 8;
/** Batches per run; the rest continue in a follow-up job, so one run stays well inside a drain. */
const MAX_BATCHES = 5;

const payload = z.object({ after: z.uuid().optional() });
type BackfillPayload = z.infer<typeof payload>;

export const fileSizeBackfillJob = (after?: string): NewJob => ({
  kind: RECEIPT_FILE_SIZE_BACKFILL,
  payload: (after ? { after } : {}) satisfies BackfillPayload,
  maxAttempts: MAX_ATTEMPTS,
  priority: 9,
  idempotencyKey: after ? `${RECEIPT_FILE_SIZE_BACKFILL}:${after}` : RECEIPT_FILE_SIZE_BACKFILL,
});

let scheduled = false;

/**
 * Queues the backfill unless its first job was ever queued, so it runs once. Checked once per
 * process, on the first drain after a deploy. A failure is logged, never fails the caller's
 * drain, and is tried again on the next one.
 */
export const scheduleFileSizeBackfill = () =>
  scheduled
    ? Effect.void
    : Effect.flatMap(Db, ({ use }) =>
        use(async (db) => {
          const job = fileSizeBackfillJob();
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

/** For tests: the next `scheduleFileSizeBackfill` checks the database again. */
export const resetFileSizeBackfillSchedule = () => {
  scheduled = false;
};

type BatchResult = { last: string | null; scanned: number; filled: number; missing: number };

/**
 * One batch: the next receipts after `after` (by id, every workspace) with a stored file and no
 * size. The HEADs run outside any transaction; one UPDATE then writes the sizes found, only where
 * none is set yet, so a retry or a second run changes nothing.
 */
export const backfillBatch = (after: string | null, limit = BACKFILL_BATCH) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const storage = yield* Storage;
    const { rows } = yield* use((db) =>
      db.execute<{ id: string; key: string }>(sql`
        select id, image_object_key as key from receipts
        where file_bytes is null and image_object_key is not null
          ${after ? sql`and id > ${after}` : sql``}
        order by id
        limit ${limit}`),
    );
    const sizes = yield* Effect.forEach(
      rows,
      (row) =>
        storage.size(row.key).pipe(
          Effect.map((bytes) => ({ id: row.id, bytes })),
          Effect.catchIf(
            (error) => error._tag === "StorageError" && error.kind === "not-found",
            () => Effect.succeed(null),
          ),
        ),
      { concurrency: CONCURRENCY },
    );
    const found = sizes.filter((size) => size !== null);
    if (found.length > 0) {
      const values = sql.join(
        found.map(({ id, bytes }) => sql`(${id}::uuid, ${bytes}::int)`),
        sql`, `,
      );
      yield* use((db) =>
        db.execute(sql`
          update receipts r set file_bytes = v.bytes
          from (values ${values}) as v(id, bytes)
          where r.id = v.id and r.file_bytes is null`),
      );
    }
    return {
      last: rows.length < limit ? null : (rows.at(-1)?.id ?? null),
      scanned: rows.length,
      filled: found.length,
      missing: rows.length - found.length,
    } satisfies BatchResult;
  });

export const receiptFileSizeBackfill: JobDefinition<BackfillPayload, Db | Storage> = {
  kind: RECEIPT_FILE_SIZE_BACKFILL,
  payload,
  maxAttempts: MAX_ATTEMPTS,
  leaseSeconds: 120,
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: ({ after }) =>
    Effect.gen(function* () {
      const { use } = yield* Db;
      let cursor: string | null = after ?? null;
      let scanned = 0;
      let filled = 0;
      let missing = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const result: BatchResult = yield* backfillBatch(cursor);
        scanned += result.scanned;
        filled += result.filled;
        missing += result.missing;
        cursor = result.last;
        if (cursor === null) break;
      }
      if (cursor !== null) {
        const next = cursor;
        yield* use((db) => enqueueJob(db, fileSizeBackfillJob(next)));
      }
      yield* annotateEvent({ counts: { scanned, filled, missing } });
      return { scanned, filled, missing, more: cursor !== null };
    }).pipe(
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError((error) => {
        switch (error._tag) {
          case "NotConfigured":
            return new NonRetryableJobError({ kind: "storage-off" });
          case "StorageError":
            return new RetryableJobError({ kind: "storage-error" });
          case "DbError":
            return new RetryableJobError({ kind: "db-error" });
        }
      }),
    ),
};
