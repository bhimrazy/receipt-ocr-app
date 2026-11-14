/**
 * The orphan sweep against real Postgres and S3 (RustFS locally). Every case lists only this
 * file's own prefix: the local bucket is shared with other databases, whose files look orphaned
 * from here. Skipped unless INTEGRATION=1.
 */
import { randomUUID } from "node:crypto";
import { eq, jobs, organization, sql, user } from "@receipt-ocr/db";
import { receiptObjectKey } from "@receipt-ocr/storage";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../../src/index";
import { enqueueJob, STORAGE_DELETE, tick, type JobRegistry } from "../../src/jobs";
import { storageDelete } from "../../src/jobs/kinds/storage-delete";
import {
  makeStorageOrphanSweep,
  STORAGE_ORPHAN_SWEEP,
  storageOrphanSweepJob,
  sweepOrphans,
} from "../../src/jobs/kinds/storage-orphan-sweep";
import { ingestUpload, purgeReceiptFiles } from "../../src/pipeline";
import { Db, Storage } from "../../src/services";
import { ensurePersonalWorkspace } from "../../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));
const storage = <A, E>(f: (s: typeof Storage.Service) => Effect.Effect<A, E>) =>
  run(Effect.flatMap(Storage, f));

const tag = `orphans-${Date.now()}`;
const userId = `${tag}-u`;
const prefix = `users/${userId}/`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
/** A cutoff in the future: every file counts as past the grace period. */
const allOld = () => new Date(Date.now() + 60_000);
const day = "2026-01-01";

const exists = (key: string) =>
  storage((s) => s.get(key)).then(
    () => true,
    () => false,
  );

const runJob = (id: string, registry: JobRegistry<Db | Storage>) =>
  run(tick({ worker: `${tag}-w`, registry, budgetMs: 30_000, ids: [id], waitForRetries: false }));

describe.skipIf(!enabled)("storage orphan sweep against Postgres and S3", () => {
  let organizationId: string;
  let referenced: string;
  let orphan: string;
  const stray = `${prefix}notes.txt`;

  beforeAll(async () => {
    await db((d) =>
      d
        .insert(user)
        .values({ id: userId, name: "O", email: `${userId}@example.com`, emailVerified: true }),
    );
    const orgId = await run(
      ensurePersonalWorkspace({ id: userId, name: "O", email: `${userId}@example.com` }),
    );
    if (!orgId) throw new Error("no workspace");
    organizationId = orgId;
    const { receipt } = await run(
      ingestUpload({
        scope: { userId, organizationId, role: "owner" },
        fileName: "r.jpg",
        body: JPEG,
        limits: { perMinute: 1000, perDay: 1000 },
      }),
    );
    referenced = receipt.imageObjectKey!;
    orphan = receiptObjectKey(userId, randomUUID(), "image/jpeg");
    await storage((s) => s.put(orphan, JPEG, "image/jpeg"));
    await storage((s) => s.put(stray, JPEG, "text/plain"));
  });

  afterEach(() => {
    delete process.env.STORAGE_ORPHAN_SWEEP_DELETE;
  });

  afterAll(async () => {
    await run(purgeReceiptFiles({ organizationId }));
    await storage((s) => s.remove([orphan, stray]));
    await db(async (d) => {
      await d
        .delete(jobs)
        .where(
          sql`${jobs.kind} in (${STORAGE_ORPHAN_SWEEP}, ${STORAGE_DELETE}) and ${jobs.createdAt} > now() - interval '1 hour' and ${jobs.payload}::text like ${`%${userId}%`}`,
        );
      await d.delete(jobs).where(eq(jobs.userId, userId));
      await d.delete(organization).where(eq(organization.id, organizationId));
      await d.delete(user).where(eq(user.id, userId));
    });
    await runtime.dispose();
  });

  it("finds a file with no receipt row, and leaves referenced, recent and unrecognised files alone", async () => {
    const old = await run(sweepOrphans({ prefix, olderThan: allOld(), pages: 5 }));
    expect(old).toMatchObject({ listed: 3, referenced: 1, unrecognised: 1, orphaned: [orphan] });
    expect(old.next).toBeUndefined();

    const fresh = await run(
      sweepOrphans({ prefix, olderThan: new Date(Date.now() - 86_400_000), pages: 5 }),
    );
    expect(fresh).toMatchObject({ listed: 3, recent: 3, orphaned: [] });
  });

  it("pages through the listing and resumes after the last key", async () => {
    const first = await run(sweepOrphans({ prefix, olderThan: allOld(), pages: 2, pageSize: 1 }));
    expect(first.listed).toBe(2);
    expect(first.next).toBeDefined();
    const rest = await run(
      sweepOrphans({ prefix, olderThan: allOld(), pages: 5, pageSize: 1, startAfter: first.next }),
    );
    expect(first.listed + rest.listed).toBe(3);
    expect([...first.orphaned, ...rest.orphaned]).toEqual([orphan]);
  });

  it("only reports by default, and queues the next part while there is more to list", async () => {
    const sweep = makeStorageOrphanSweep({ graceMs: -60_000, pages: 1, pageSize: 2 });
    const queued = await db((d) => enqueueJob(d, storageOrphanSweepJob({ day, part: 0, prefix })));
    if (!("id" in queued)) throw new Error("not queued");
    const stats = await runJob(queued.id, { [sweep.kind]: sweep });
    expect(stats.runs.map((r) => r.outcome)).toEqual(["succeeded"]);
    expect(await exists(orphan)).toBe(true);

    const parts = await db((d) =>
      d
        .select({ key: jobs.idempotencyKey, state: jobs.state, payload: jobs.payload })
        .from(jobs)
        .where(sql`${jobs.idempotencyKey} like ${`${STORAGE_ORPHAN_SWEEP}:${day}:${prefix}:%`}`)
        .orderBy(jobs.createdAt),
    );
    expect(parts.map((p) => p.state)).toEqual(["succeeded", "queued"]);
    expect(parts[1]!.payload).toMatchObject({ part: 1, prefix, startAfter: expect.any(String) });
    const deletes = await db((d) =>
      d
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          sql`${jobs.kind} = ${STORAGE_DELETE} and ${jobs.payload}::text like ${`%${userId}%`}`,
        ),
    );
    expect(deletes).toEqual([]);
    await db((d) =>
      d.delete(jobs).where(sql`${jobs.idempotencyKey} like ${`${STORAGE_ORPHAN_SWEEP}:${day}:%`}`),
    );
  });

  it("with deletion on, deletes orphans through storage.delete and nothing else", async () => {
    process.env.STORAGE_ORPHAN_SWEEP_DELETE = "true";
    const sweep = makeStorageOrphanSweep({ graceMs: -60_000, pages: 5 });
    const queued = await db((d) =>
      enqueueJob(d, storageOrphanSweepJob({ day: "2026-01-02", part: 0, prefix })),
    );
    if (!("id" in queued)) throw new Error("not queued");
    expect((await runJob(queued.id, { [sweep.kind]: sweep })).runs[0]?.outcome).toBe("succeeded");

    const [deleteJob] = await db((d) =>
      d
        .select({ id: jobs.id, payload: jobs.payload })
        .from(jobs)
        .where(
          sql`${jobs.kind} = ${STORAGE_DELETE} and ${jobs.payload}::text like ${`%${userId}%`}`,
        ),
    );
    expect(deleteJob?.payload).toEqual({ keys: [orphan] });
    await runJob(deleteJob!.id, { [storageDelete.kind]: storageDelete });
    expect(await exists(orphan)).toBe(false);
    expect(await exists(referenced)).toBe(true);
    expect(await exists(stray)).toBe(true);
  });
});
