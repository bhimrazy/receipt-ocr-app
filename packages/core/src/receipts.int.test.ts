/**
 * Integration tests against real Postgres and S3 (RustFS locally). Skipped
 * unless INTEGRATION=1; run with `bun run --filter @receipt-ocr/core test:int`
 * after `bun run db:migrate`, with DATABASE_URL and S3_* set and
 * OCR_PROVIDER=fixture.
 */
import { FIXTURE_RECEIPTS } from "@receipt-ocr/ai";
import { member, organization, receipts, sql, user } from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "./index";
import { deleteReceipt, extractStored, ingestUpload, purgeReceiptFiles } from "./pipeline";
import { checkQuota } from "./quota";
import { ReceiptRepo, STALE_AFTER_MS } from "./repository";
import { Db, Storage } from "./services";
import { ensurePersonalWorkspace, hitRateLimit, resolveScope } from "./workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);

const tag = `int-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  await run(
    Effect.flatMap(Db, ({ use }) =>
      use((db) =>
        db.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
      ),
    ),
  );
  const orgId = await run(ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }));
  if (!orgId) throw new Error("no workspace");
  return { userId: id, organizationId: orgId, role: "owner" };
}

describe.skipIf(!enabled)("receipts against Postgres + S3", () => {
  let a: Awaited<ReturnType<typeof createUser>>;
  let b: Awaited<ReturnType<typeof createUser>>;
  let receiptId: string;
  let objectKey: string;

  beforeAll(async () => {
    a = await createUser("alice");
    b = await createUser("bob");
    const ingested = await run(ingestUpload({ scope: a, fileName: "lunch.jpg", body: JPEG }));
    receiptId = ingested.receipt.id;
    objectKey = ingested.receipt.imageObjectKey!;
    await run(extractStored({ receiptId, scope: a }));
  });

  afterAll(async () => {
    for (const owner of [a, b])
      await run(purgeReceiptFiles({ organizationId: owner.organizationId }));
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use(async (db) => {
          await db.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
          await db.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
        }),
      ),
    );
    await runtime.dispose();
  });

  it("U4: bootstraps one workspace with an owner, idempotently", async () => {
    expect(await run(ensurePersonalWorkspace({ id: a.userId, email: "x@example.com" }))).toBeNull();
    const scope = await run(resolveScope(a.userId));
    expect(scope).toEqual({ organizationId: a.organizationId, userId: a.userId, role: "owner" });
  });

  it("completes through the fixture provider with a canonical category", async () => {
    const receipt = await run(Effect.flatMap(ReceiptRepo, (repo) => repo.get(receiptId, a)));
    expect(receipt?.status).toBe("completed");
    expect(receipt?.items.length).toBeGreaterThan(0);
    expect(receipt?.fileName).toBe("lunch.jpg");
    const [exported] = await run(Effect.flatMap(ReceiptRepo, (repo) => repo.exportRows(a, {}, 10)));
    expect(exported?.itemCount).toBe(receipt?.items.length);
  });

  it("workspace isolation: org B cannot read, list, export, edit, retry or delete org A's receipt", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f));
    expect(await repo((r) => r.get(receiptId, b))).toBeNull();
    expect((await repo((r) => r.list(b, {}, { limit: 50, offset: 0 }))).total).toBe(0);
    expect(await repo((r) => r.exportRows(b, {}, 50))).toEqual([]);
    expect(await repo((r) => r.update(receiptId, b, { merchant: "pwned" }))).toBe(false);
    expect(await repo((r) => r.claimRetry(receiptId, b))).toEqual({ kind: "not-found" });
    const deleted = await runExit(deleteReceipt({ receiptId, scope: b }));
    expect(Exit.isFailure(deleted)).toBe(true);
    const still = await repo((r) => r.get(receiptId, a));
    expect(still?.merchant).not.toBe("pwned");
  });

  it("B1: a removed member's stale active workspace no longer resolves", async () => {
    // Bob joins Alice's workspace, then is removed; his session still names it.
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((db) =>
          db.insert(member).values({
            id: `${tag}-m`,
            organizationId: a.organizationId,
            userId: b.userId,
            role: "member",
            createdAt: new Date(),
          }),
        ),
      ),
    );
    expect((await run(resolveScope(b.userId, a.organizationId)))?.organizationId).toBe(
      a.organizationId,
    );
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((db) => db.delete(member).where(sql`${member.id} = ${`${tag}-m`}`)),
      ),
    );
    const scope = await run(resolveScope(b.userId, a.organizationId));
    expect(scope?.organizationId).toBe(b.organizationId);
    expect(await run(Effect.flatMap(ReceiptRepo, (r) => r.get(receiptId, scope!)))).toBeNull();
  });

  it("L2: a plain member cannot delete someone else's receipt", async () => {
    const asMember = { organizationId: a.organizationId, userId: b.userId, role: "member" };
    expect(await run(Effect.flatMap(ReceiptRepo, (r) => r.remove(receiptId, asMember)))).toBeNull();
  });

  it("filters server-side by search, category, needs-review and date", async () => {
    const list = (filters: object) =>
      run(Effect.flatMap(ReceiptRepo, (r) => r.list(a, filters, { limit: 50, offset: 0 })));
    const receipt = await run(Effect.flatMap(ReceiptRepo, (r) => r.get(receiptId, a)));
    expect((await list({ q: receipt!.merchant!.slice(0, 4).toLowerCase() })).total).toBe(1);
    expect((await list({ q: "lunch" })).total).toBe(1);
    expect((await list({ q: "100%_" })).total).toBe(0);
    expect((await list({ category: receipt!.category })).total).toBe(1);
    expect((await list({ category: "Software" })).total).toBe(0);
    expect((await list({ from: receipt!.receiptDate, to: receipt!.receiptDate })).total).toBe(1);
    expect((await list({ from: "2099-01-01" })).total).toBe(0);
    const needsReview = Number(receipt!.confidence) < 0.9 ? 1 : 0;
    expect((await list({ status: "needs-review" })).total).toBe(needsReview);
    const counts = await run(Effect.flatMap(ReceiptRepo, (r) => r.counts(a)));
    expect(counts.needsReview).toBe(needsReview);
    expect(counts.total).toBe((await list({})).total);
  });

  it("U2: a receipt stuck in processing reads as failed and stops counting against quota", async () => {
    const stuck = await run(ingestUpload({ scope: a, fileName: "stuck.jpg", body: JPEG }));
    const limits = { perMinute: 100, perDay: 100 };
    const before = await run(checkQuota(a.userId, limits));
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((db) =>
          db
            .update(receipts)
            .set({ updatedAt: new Date(Date.now() - STALE_AFTER_MS - 1000) })
            .where(sql`${receipts.id} = ${stuck.receipt.id}`),
        ),
      ),
    );
    const read = await run(Effect.flatMap(ReceiptRepo, (r) => r.get(stuck.receipt.id, a)));
    expect(read?.status).toBe("failed");
    const failedRows = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.list(a, { status: "failed" }, { limit: 50, offset: 0 })),
    );
    expect(failedRows.rows.map((row) => row.id)).toContain(stuck.receipt.id);
    expect((await run(checkQuota(a.userId, limits))).used).toBe(before.used - 1);
    expect(
      await run(Effect.flatMap(ReceiptRepo, (r) => r.claimRetry(stuck.receipt.id, a))),
    ).toMatchObject({
      kind: "claimed",
    });
  });

  it("retries count against the burst and global windows, and stop after the attempt cap", async () => {
    const failing = await run(ingestUpload({ scope: a, fileName: "blurry.jpg", body: JPEG }));
    const id = failing.receipt.id;
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const window = () => {
      const now = Date.now();
      return {
        userId: a.userId,
        dayStart: new Date(now - 60 * 60 * 1000),
        minuteStart: new Date(now - 60 * 1000),
        includeGlobal: true,
      };
    };
    let attempt = 1;
    const markFailed = () => repo((r) => r.fail(id, a, attempt, "unreadable"));

    await markFailed();
    const before = await repo((r) => r.usage(window()));
    expect(await repo((r) => r.claimRetry(id, a))).toMatchObject({ kind: "claimed" });
    attempt += 1;
    const after = await repo((r) => r.usage(window()));
    expect(after.userMinute).toBe(before.userMinute + 1);
    expect(after.globalDay).toBe((before.globalDay ?? 0) + 1);

    await markFailed();
    expect(await repo((r) => r.claimRetry(id, a))).toMatchObject({ kind: "claimed" });
    attempt += 1;
    await markFailed();
    expect(await repo((r) => r.claimRetry(id, a))).toEqual({ kind: "attempts-exhausted" });
  });

  it("only the current attempt can complete or fail a receipt", async () => {
    const fresh = await run(ingestUpload({ scope: a, fileName: "race.jpg", body: JPEG }));
    const id = fresh.receipt.id;
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const extraction = FIXTURE_RECEIPTS[0]!;

    // Attempt 1 times out and fails, a retry claims attempt 2.
    expect(await repo((r) => r.fail(id, a, 1, "slow"))).toBe(true);
    expect(await repo((r) => r.claimRetry(id, a))).toMatchObject({ kind: "claimed" });

    // The stale attempt 1 finishing late can neither complete nor fail attempt 2.
    expect(await repo((r) => r.complete(id, a, 1, extraction, "fixture"))).toBeNull();
    expect(await repo((r) => r.fail(id, a, 1, "late"))).toBe(false);
    expect((await repo((r) => r.get(id, a)))?.status).toBe("processing");

    expect(await repo((r) => r.complete(id, a, 2, extraction, "fixture"))).not.toBeNull();
    // A duplicate completion or a late failure cannot touch the finished receipt.
    const other = { ...extraction, merchant: "Overwritten" };
    expect(await repo((r) => r.complete(id, a, 2, other, "fixture"))).toBeNull();
    expect(await repo((r) => r.fail(id, a, 2, "dup"))).toBe(false);
    expect(await repo((r) => r.get(id, a))).toMatchObject({
      status: "completed",
      merchant: extraction.merchant,
    });
  });

  it("U1: deleting a receipt deletes its stored object", async () => {
    const storage = <A>(f: (s: typeof Storage.Service) => Effect.Effect<A, unknown>) =>
      runExit(Effect.flatMap(Storage, f));
    expect(Exit.isSuccess(await storage((s) => s.get(objectKey)))).toBe(true);
    await run(deleteReceipt({ receiptId, scope: a }));
    expect(Exit.isFailure(await storage((s) => s.get(objectKey)))).toBe(true);
  });

  it("U8: the contact rate limit counts across calls and resets after the window", async () => {
    const key = `${tag}:contact`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await run(hitRateLimit(key, 60_000, 3))).allowed);
    expect(results).toEqual([true, true, true, false]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await run(hitRateLimit(key, 1, 3))).allowed).toBe(true);
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use((db) => db.execute(sql`delete from rate_limit where id = ${key}`)),
      ),
    );
  });
});
