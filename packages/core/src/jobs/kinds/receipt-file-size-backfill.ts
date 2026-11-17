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
 * Fills `receipts.file_bytes` for receipts stored without it, from each object's size (a HEAD,
 * nothing downloaded), so the storage cap counts them. A receipt whose object is missing gets 0 and
 * is reported in `counts.missing`. Like `receipt.recheck`, its jobs carry no `receipt_id`.
 */
export const RECEIPT_FILE_SIZE_BACKFILL = "receipt.file_size_backfill";
const MAX_ATTEMPTS = 5;

/** Receipts per batch, and HEAD requests in flight at once. */
export const BACKFILL_BATCH = 100;
const CONCURRENCY = 8;
/** Batches per run; the rest continue in a follow-up job, so one run stays well inside a drain. */
const MAX_BATCHES = 5;

/**
 * A run queues its follow-up under the other key: its own is still live (running) while it does,
 * and a retry after that enqueue finds the follow-up already queued.
 */
const KEYS = [RECEIPT_FILE_SIZE_BACKFILL, `${RECEIPT_FILE_SIZE_BACKFILL}:next`] as const;

const payload = z.object({});
type BackfillPayload = z.infer<typeof payload>;

export const fileSizeBackfillJob = (key: (typeof KEYS)[number] = KEYS[0]): NewJob => ({
  kind: RECEIPT_FILE_SIZE_BACKFILL,
  payload: {} satisfies BackfillPayload,
  maxAttempts: MAX_ATTEMPTS,
  priority: 9,
  idempotencyKey: key,
});

const UNSIZED = sql`file_bytes is null and image_object_key is not null`;

let scheduled = false;

/**
 * Queues the backfill when a receipt has no size and no backfill job is live. Checked once per
 * process, on its first drain, so each deploy picks up rows an older release wrote and starts a
 * dead run again. A failure is logged, never fails the caller's drain, and is tried again on the
 * next one.
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
            where exists (select 1 from receipts where ${UNSIZED})
              and not exists (select 1 from jobs where kind = ${job.kind} and state in ('queued', 'running'))
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

type BatchResult = { scanned: number; filled: number; missing: number };

/**
 * One batch: up to `limit` receipts (every workspace) with a stored file and no size. The HEADs run
 * outside any transaction; one UPDATE then writes each size, or 0 for a missing object, only where
 * none is set yet, so an upload's own size is never overwritten and a rerun changes nothing. Every
 * row it reads gets a value, so the next batch moves on without a cursor.
 */
export const backfillBatch = (limit = BACKFILL_BATCH) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const storage = yield* Storage;
    const { rows } = yield* use((db) =>
      db.execute<{ id: string; key: string }>(
        sql`select id, image_object_key as key from receipts where ${UNSIZED} limit ${limit}`,
      ),
    );
    const sizes = yield* Effect.forEach(
      rows,
      (row) =>
        storage.size(row.key).pipe(
          Effect.map((bytes) => ({ id: row.id, bytes, missing: false })),
          Effect.catchIf(
            (error) => error._tag === "StorageError" && error.kind === "not-found",
            () => Effect.succeed({ id: row.id, bytes: 0, missing: true }),
          ),
        ),
      { concurrency: CONCURRENCY },
    );
    if (sizes.length > 0) {
      const values = sql.join(
        sizes.map(({ id, bytes }) => sql`(${id}::uuid, ${bytes}::int)`),
        sql`, `,
      );
      yield* use((db) =>
        db.execute(sql`
          update receipts r set file_bytes = v.bytes
          from (values ${values}) as v(id, bytes)
          where r.id = v.id and r.file_bytes is null`),
      );
    }
    const missing = sizes.filter((size) => size.missing).length;
    return { scanned: rows.length, filled: rows.length - missing, missing } satisfies BatchResult;
  });

/**
 * One run: batches until one comes back short or `batches` have run, then a follow-up job under
 * the other key if any receipt still has no size. `key` is the running job's idempotency key.
 */
export const backfillRun = (
  key: string | null,
  { batch = BACKFILL_BATCH, batches = MAX_BATCHES }: { batch?: number; batches?: number } = {},
) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    let scanned = 0;
    let filled = 0;
    let missing = 0;
    for (let i = 0; i < batches; i++) {
      const result: BatchResult = yield* backfillBatch(batch);
      scanned += result.scanned;
      filled += result.filled;
      missing += result.missing;
      if (result.scanned < batch) break;
    }
    // Checked again rather than inferred from the last batch: an older release may have written a
    // row during this run.
    const { rows } = yield* use((db) =>
      db.execute<{ more: boolean }>(
        sql`select exists (select 1 from receipts where ${UNSIZED}) as more`,
      ),
    );
    const more = rows[0]?.more === true;
    if (more) {
      const next = key === KEYS[0] ? KEYS[1] : KEYS[0];
      yield* use((db) => enqueueJob(db, fileSizeBackfillJob(next)));
    }
    return { scanned, filled, missing, more };
  });

export const receiptFileSizeBackfill: JobDefinition<BackfillPayload, Db | Storage> = {
  kind: RECEIPT_FILE_SIZE_BACKFILL,
  payload,
  maxAttempts: MAX_ATTEMPTS,
  leaseSeconds: 120,
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: (_payload, { job }) =>
    backfillRun(job.idempotencyKey).pipe(
      Effect.tap(({ scanned, filled, missing }) =>
        annotateEvent({ counts: { scanned, filled, missing } }),
      ),
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
