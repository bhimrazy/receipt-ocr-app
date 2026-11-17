/**
 * The file-size backfill against real Postgres and S3 (RustFS locally). Skipped unless
 * INTEGRATION=1; see receipts.int.test.ts for the setup.
 */
import { and, eq, inArray, jobs, organization, receipts, sql, user } from "@receipt-ocr/db";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../../src/index";
import {
  JOB_REGISTRY,
  RECEIPT_FILE_SIZE_BACKFILL,
  resetFileSizeBackfillSchedule,
  scheduleFileSizeBackfill,
  tick,
} from "../../src/jobs";
import { backfillRun } from "../../src/jobs/kinds/receipt-file-size-backfill";
import { ingestUpload, purgeReceiptFiles } from "../../src/pipeline";
import type { ReceiptScope } from "../../src/repository";
import { StorageError } from "../../src/errors";
import { Db, Storage } from "../../src/services";
import { ensurePersonalWorkspace } from "../../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `sizes-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
const limits = { perMinute: 1000, perDay: 1000 };
const NEXT_KEY = `${RECEIPT_FILE_SIZE_BACKFILL}:next`;

async function createUser(name: string): Promise<ReceiptScope> {
  const id = `${tag}-${name}`;
  await db((d) =>
    d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
  );
  const organizationId = await run(
    ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }),
  );
  if (!organizationId) throw new Error("no workspace");
  return { userId: id, organizationId, role: "owner" };
}

/** Uploads `n` receipts, then clears their sizes as if an older release had stored them. */
async function unsized(scope: ReceiptScope, n: number) {
  const ids: string[] = [];
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const { receipt } = await run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    ids.push(receipt.id);
    keys.push(receipt.imageObjectKey!);
  }
  // Their extraction jobs aren't part of this test.
  await db((d) => d.delete(jobs).where(inArray(jobs.receiptId, ids)));
  await db((d) => d.update(receipts).set({ fileBytes: null }).where(inArray(receipts.id, ids)));
  return { ids, keys };
}

const sizes = async (ids: string[]) => {
  const rows = await db((d) =>
    d
      .select({ id: receipts.id, fileBytes: receipts.fileBytes })
      .from(receipts)
      .where(inArray(receipts.id, ids)),
  );
  return ids.map((id) => rows.find((row) => row.id === id)?.fileBytes);
};

const backfillJobs = () =>
  db((d) =>
    d
      .select({ id: jobs.id, key: jobs.idempotencyKey, state: jobs.state })
      .from(jobs)
      .where(eq(jobs.kind, RECEIPT_FILE_SIZE_BACKFILL)),
  );

/** Runs the backfill's live jobs, and the follow-ups they queue, until none is left. */
async function drainBackfill() {
  for (let i = 0; i < 100; i++) {
    const live = await db((d) =>
      d
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.kind, RECEIPT_FILE_SIZE_BACKFILL),
            inArray(jobs.state, ["queued", "running"]),
          ),
        ),
    );
    if (live.length === 0) return;
    await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 60_000,
        ids: live.map((job) => job.id),
        waitForRetries: false,
      }),
    );
  }
}

async function schedule() {
  resetFileSizeBackfillSchedule();
  await run(scheduleFileSizeBackfill());
}

describe.skipIf(!enabled)("receipt.file_size_backfill against Postgres and S3", () => {
  const scopes: ReceiptScope[] = [];

  beforeEach(async () => {
    await db((d) => d.delete(jobs).where(eq(jobs.kind, RECEIPT_FILE_SIZE_BACKFILL)));
  });

  afterAll(async () => {
    for (const scope of scopes) {
      await run(purgeReceiptFiles({ organizationId: scope.organizationId }));
    }
    await db(async (d) => {
      await d.delete(jobs).where(eq(jobs.kind, RECEIPT_FILE_SIZE_BACKFILL));
      await d.delete(jobs).where(sql`${jobs.userId} like ${`${tag}%`}`);
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  it("fills sizes from the stored objects, 0 for a missing one, and a rerun changes nothing", async () => {
    const scope = await createUser("ann");
    scopes.push(scope);
    const { ids, keys } = await unsized(scope, 4);
    // One keeps the size its upload recorded, which the backfill must not touch.
    await db((d) => d.update(receipts).set({ fileBytes: 7 }).where(eq(receipts.id, ids[3]!)));
    await run(Effect.flatMap(Storage, (s) => s.remove([keys[2]!])));

    await schedule();
    await schedule();
    expect(await backfillJobs()).toEqual([
      expect.objectContaining({ key: RECEIPT_FILE_SIZE_BACKFILL, state: "queued" }),
    ]);

    await drainBackfill();
    const filled = [JPEG.byteLength, JPEG.byteLength, 0, 7];
    expect(await sizes(ids)).toEqual(filled);
    expect((await backfillJobs()).every((job) => job.state === "succeeded")).toBe(true);

    // Nothing left without a size: a new process queues nothing, and a forced run changes nothing.
    await schedule();
    expect((await backfillJobs()).filter((job) => job.state === "queued")).toEqual([]);
    const again = await run(backfillRun(RECEIPT_FILE_SIZE_BACKFILL));
    expect(again).toMatchObject({ more: false });
    expect(await sizes(ids)).toEqual(filled);
  });

  it("continues past one run in a follow-up job, across a missing object", async () => {
    const scope = await createUser("bea");
    scopes.push(scope);
    const { ids, keys } = await unsized(scope, 5);
    await run(Effect.flatMap(Storage, (s) => s.remove([keys[1]!])));

    const first = await run(backfillRun(RECEIPT_FILE_SIZE_BACKFILL, { batch: 2, batches: 1 }));
    expect(first).toMatchObject({ scanned: 2, more: true });
    expect(await backfillJobs()).toEqual([expect.objectContaining({ key: NEXT_KEY })]);
    // A retry of that run, after its enqueue, finds the follow-up already queued.
    await run(backfillRun(RECEIPT_FILE_SIZE_BACKFILL, { batch: 2, batches: 1 }));
    expect(await backfillJobs()).toHaveLength(1);

    await run(backfillRun(NEXT_KEY, { batch: 2, batches: 2 }));
    expect((await backfillJobs()).map((job) => job.key)).toEqual([NEXT_KEY]);
    expect((await sizes(ids)).filter((size) => size === null)).toEqual([]);
    expect((await sizes(ids)).filter((size) => size === 0)).toHaveLength(1);
  });

  it("picks up a receipt written without a size after a finished run", async () => {
    const scope = await createUser("cat");
    scopes.push(scope);
    const before = await unsized(scope, 1);
    await schedule();
    await drainBackfill();
    expect(await sizes(before.ids)).toEqual([JPEG.byteLength]);

    // An older release, still serving during the deploy, stores one more without a size.
    const late = await unsized(scope, 1);
    await schedule();
    expect((await backfillJobs()).filter((job) => job.state === "queued")).toHaveLength(1);
    await drainBackfill();
    expect(await sizes(late.ids)).toEqual([JPEG.byteLength]);
  });

  it("starts again after a run that died", async () => {
    const scope = await createUser("dan");
    scopes.push(scope);
    const { ids } = await unsized(scope, 1);
    await schedule();
    await db((d) =>
      d
        .update(jobs)
        .set({ state: "dead", finishedAt: new Date() })
        .where(eq(jobs.kind, RECEIPT_FILE_SIZE_BACKFILL)),
    );
    await schedule();
    await drainBackfill();
    expect(await sizes(ids)).toEqual([JPEG.byteLength]);
  });

  it("sizes the rest when one object can't be read, and retries only when nothing could be", async () => {
    const scope = await createUser("eve");
    scopes.push(scope);
    const { ids, keys } = await unsized(scope, 4);
    const bad = keys[1]!;
    const flaky = Effect.flatMap(Storage, (real) =>
      Effect.succeed({
        ...real,
        size: (key: string) =>
          key === bad ? Effect.fail(new StorageError({ message: "HTTP 500" })) : real.size(key),
      }),
    );
    const withFlaky = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(flaky, (storage) => Effect.provideService(effect, Storage, storage));

    const first = await run(
      withFlaky(backfillRun(RECEIPT_FILE_SIZE_BACKFILL, { batch: 2, batches: 5 })),
    );
    expect(first).toMatchObject({ failed: 1, more: false, stalled: false });
    expect(await sizes(ids)).toEqual([JPEG.byteLength, null, JPEG.byteLength, JPEG.byteLength]);
    expect(await backfillJobs()).toEqual([]);

    // Only the unreadable one is left: the run made no progress, so the job retries later.
    const again = await run(withFlaky(backfillRun(RECEIPT_FILE_SIZE_BACKFILL)));
    expect(again).toMatchObject({ scanned: 1, failed: 1, stalled: true });

    await run(backfillRun(RECEIPT_FILE_SIZE_BACKFILL));
    expect(await sizes(ids)).toEqual(Array(4).fill(JPEG.byteLength));
  });
});
