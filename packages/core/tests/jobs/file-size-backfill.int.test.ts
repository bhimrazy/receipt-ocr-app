/**
 * The file-size backfill against real Postgres and S3 (RustFS locally). Skipped unless
 * INTEGRATION=1; see receipts.int.test.ts for the setup.
 */
import { and, eq, inArray, jobs, organization, receipts, sql, user } from "@receipt-ocr/db";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../../src/index";
import {
  JOB_REGISTRY,
  RECEIPT_FILE_SIZE_BACKFILL,
  resetFileSizeBackfillSchedule,
  scheduleFileSizeBackfill,
  tick,
} from "../../src/jobs";
import { ingestUpload, purgeReceiptFiles } from "../../src/pipeline";
import type { ReceiptScope } from "../../src/repository";
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

describe.skipIf(!enabled)("receipt.file_size_backfill against Postgres and S3", () => {
  let scope: ReceiptScope;

  afterAll(async () => {
    if (scope) await run(purgeReceiptFiles({ organizationId: scope.organizationId }));
    await db(async (d) => {
      await d.delete(jobs).where(sql`${jobs.userId} like ${`${tag}%`}`);
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  it("fills sizes from the stored objects once, leaving missing objects null", async () => {
    scope = await createUser("ann");
    const ids: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { receipt } = await run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
      ids.push(receipt.id);
      keys.push(receipt.imageObjectKey!);
    }
    // Their extraction jobs aren't part of this test.
    await db((d) => d.delete(jobs).where(inArray(jobs.receiptId, ids)));
    // Three stored before sizes were recorded, one of them with its object gone; one keeps the
    // size its upload recorded, which the backfill must not touch.
    await db((d) =>
      d
        .update(receipts)
        .set({ fileBytes: null })
        .where(inArray(receipts.id, ids.slice(0, 3))),
    );
    await db((d) => d.update(receipts).set({ fileBytes: 7 }).where(eq(receipts.id, ids[3]!)));
    await run(Effect.flatMap(Storage, (s) => s.remove([keys[2]!])));

    await db((d) => d.delete(jobs).where(eq(jobs.kind, RECEIPT_FILE_SIZE_BACKFILL)));
    resetFileSizeBackfillSchedule();
    await run(scheduleFileSizeBackfill());
    resetFileSizeBackfillSchedule();
    await run(scheduleFileSizeBackfill());
    const root = await db((d) =>
      d.select().from(jobs).where(eq(jobs.idempotencyKey, RECEIPT_FILE_SIZE_BACKFILL)),
    );
    expect(root).toHaveLength(1);

    await drainBackfill();
    const sizes = async () => {
      const rows = await db((d) =>
        d
          .select({ id: receipts.id, fileBytes: receipts.fileBytes })
          .from(receipts)
          .where(inArray(receipts.id, ids)),
      );
      return ids.map((id) => rows.find((row) => row.id === id)?.fileBytes);
    };
    expect(await sizes()).toEqual([JPEG.byteLength, JPEG.byteLength, null, 7]);
    const [done] = await db((d) => d.select().from(jobs).where(eq(jobs.id, root[0]!.id)));
    expect(done?.state).toBe("succeeded");

    // Finished, it isn't queued again.
    resetFileSizeBackfillSchedule();
    await run(scheduleFileSizeBackfill());
    expect(
      await db((d) =>
        d.select().from(jobs).where(eq(jobs.idempotencyKey, RECEIPT_FILE_SIZE_BACKFILL)),
      ),
    ).toHaveLength(1);
    expect(await sizes()).toEqual([JPEG.byteLength, JPEG.byteLength, null, 7]);
  });
});
