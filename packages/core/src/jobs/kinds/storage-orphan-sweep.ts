import { inArray, receipts } from "@receipt-ocr/db";
import { Effect } from "effect";
import { z } from "zod";
import { MAX_BULK_DELETE } from "../../bulk-limits";
import { loadOrphanSweepDelete } from "../../config";
import { isUuid } from "../../ids";
import { Db, Storage } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { errorFields } from "../../telemetry/redact";
import {
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type NewJob,
} from "../definition";
import { enqueueJob } from "../queue";
import { storageDeleteJob } from "../storage-delete-job";

/** Finds stored receipt files no receipt row points at; deletes them only when enabled. */
export const STORAGE_ORPHAN_SWEEP = "storage.orphan_sweep";
const STORAGE_ORPHAN_SWEEP_MAX_ATTEMPTS = 5;

/** Every receipt file lives under here (`receiptObjectKey`). */
const RECEIPTS_PREFIX = "users/";
/** An upload stores the file before its row commits; a day is far past any upload still in flight. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** Parts per day: with the default part size the sweep covers 200,000 files a day, then starts over. */
const MAX_PARTS = 20;
/** At most this many orphaned keys go on the run's event, for review. */
const SAMPLE_KEYS = 20;

const RECEIPT_KEY = /^users\/[^/]+\/receipts\/([^/]+)\.[a-z]+$/;

/** The receipt id a key was made for, or undefined for a key `receiptObjectKey` didn't make. */
export const receiptIdOfKey = (key: string) => {
  const id = RECEIPT_KEY.exec(key)?.[1];
  return id && isUuid(id) ? id : undefined;
};

const storageOrphanSweepPayload = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  part: z.number().int().min(0).max(MAX_PARTS),
  /** Narrows the sweep below `users/` (one user's files). */
  prefix: z.string().startsWith(RECEIPTS_PREFIX).max(512).optional(),
  startAfter: z.string().min(1).max(1024).optional(),
});
type StorageOrphanSweepPayload = z.infer<typeof storageOrphanSweepPayload>;

/**
 * One part of `day`'s sweep. Keyed by day and part, so a retried part, or a second purge run
 * on the same day, queues the same job again only once it has finished.
 */
export const storageOrphanSweepJob = (payload: StorageOrphanSweepPayload): NewJob => ({
  kind: STORAGE_ORPHAN_SWEEP,
  payload,
  maxAttempts: STORAGE_ORPHAN_SWEEP_MAX_ATTEMPTS,
  priority: 9,
  idempotencyKey: `${STORAGE_ORPHAN_SWEEP}:${payload.day}:${payload.prefix ?? ""}:${payload.part}`,
});

type SweepResult = {
  listed: number;
  /** Modified after `olderThan`: possibly an upload in flight, never touched. */
  recent: number;
  referenced: number;
  /** Keys under the prefix that `receiptObjectKey` didn't make: reported, never deleted. */
  unrecognised: number;
  orphaned: string[];
  /** Where the next part starts; absent once the listing is done. */
  next?: string;
};

/**
 * Lists up to `pages` pages of `prefix` after `startAfter` and returns the files older than
 * `olderThan` whose receipt row doesn't exist. A key carries its receipt's id and only that row
 * ever points at it, so a primary-key lookup decides. Cross-workspace on purpose: this is
 * platform maintenance, not a tenant read.
 */
export const sweepOrphans = (input: {
  prefix: string;
  startAfter?: string;
  olderThan: Date;
  pages: number;
  pageSize?: number;
}) =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    const { use } = yield* Db;
    const result: SweepResult = {
      listed: 0,
      recent: 0,
      referenced: 0,
      unrecognised: 0,
      orphaned: [],
    };
    let cursor = input.startAfter;
    for (let page = 0; page < input.pages; page++) {
      const { objects, next } = yield* storage.list({
        prefix: input.prefix,
        startAfter: cursor,
        maxKeys: input.pageSize,
      });
      result.listed += objects.length;
      const candidates = new Map<string, string>();
      for (const object of objects) {
        const id = receiptIdOfKey(object.key);
        if (object.lastModified >= input.olderThan) result.recent += 1;
        else if (id) candidates.set(object.key, id);
        else result.unrecognised += 1;
      }
      if (candidates.size > 0) {
        const ids = [...new Set(candidates.values())];
        const rows = yield* use((db) =>
          db.select({ id: receipts.id }).from(receipts).where(inArray(receipts.id, ids)),
        );
        const existing = new Set(rows.map((r) => r.id));
        for (const [key, id] of candidates) {
          if (existing.has(id)) result.referenced += 1;
          else result.orphaned.push(key);
        }
      }
      cursor = next;
      if (!next) break;
    }
    if (cursor) result.next = cursor;
    return result;
  });

/**
 * The sweep job. Report-only unless `STORAGE_ORPHAN_SWEEP_DELETE=true`: the run's event carries
 * the counts and a sample of orphaned keys. With deletion on, orphans go to `storage.delete`
 * jobs, which retry on their own. A part that has more to list queues the next part. Options are
 * for tests; the registry runs `storageOrphanSweep`.
 */
export const makeStorageOrphanSweep = (options: {
  graceMs: number;
  pages: number;
  pageSize?: number;
}): JobDefinition<StorageOrphanSweepPayload, Db | Storage> => ({
  kind: STORAGE_ORPHAN_SWEEP,
  payload: storageOrphanSweepPayload,
  maxAttempts: STORAGE_ORPHAN_SWEEP_MAX_ATTEMPTS,
  leaseSeconds: 120,
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: (payload) =>
    Effect.gen(function* () {
      const { use } = yield* Db;
      const deleteOrphans = yield* loadOrphanSweepDelete;
      const result = yield* sweepOrphans({
        prefix: payload.prefix ?? RECEIPTS_PREFIX,
        startAfter: payload.startAfter,
        olderThan: new Date(Date.now() - options.graceMs),
        pages: options.pages,
        pageSize: options.pageSize,
      });
      let deleteJobs = 0;
      if (deleteOrphans) {
        for (let i = 0; i < result.orphaned.length; i += MAX_BULK_DELETE) {
          const keys = result.orphaned.slice(i, i + MAX_BULK_DELETE);
          yield* use((db) => enqueueJob(db, storageDeleteJob(keys)));
          deleteJobs += 1;
        }
      }
      const more = result.next !== undefined;
      const capped = more && payload.part + 1 >= MAX_PARTS;
      if (more && !capped) {
        const next = { ...payload, part: payload.part + 1, startAfter: result.next };
        yield* use((db) => enqueueJob(db, storageOrphanSweepJob(next)));
      }
      yield* annotateEvent({
        count: result.orphaned.length,
        counts: {
          listed: result.listed,
          recent: result.recent,
          referenced: result.referenced,
          unrecognised: result.unrecognised,
          orphaned: result.orphaned.length,
          delete_jobs: deleteJobs,
          part: payload.part,
        },
        flags: { orphan_delete: deleteOrphans, more, capped },
        storage_keys: result.orphaned.slice(0, SAMPLE_KEYS),
      });
      return { listed: result.listed, orphaned: result.orphaned.length, deleteJobs, more, capped };
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
});

/** Ten pages of 1000 keys a part, so one run stays well inside its lease. */
export const storageOrphanSweep = makeStorageOrphanSweep({ graceMs: ORPHAN_GRACE_MS, pages: 10 });
