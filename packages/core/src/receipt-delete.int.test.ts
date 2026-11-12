/**
 * Bulk delete against real Postgres and S3 (RustFS locally): workspace and role scoping, the
 * filter target, and the job that deletes the stored files. Skipped unless INTEGRATION=1; see
 * receipts.int.test.ts for the setup.
 */
import { eq, inArray, jobs, member, organization, receipts, sql, user } from "@receipt-ocr/db";
import { Cause, Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "./index";
import { JOB_REGISTRY, STORAGE_DELETE, tick } from "./jobs";
import { deleteReceipts, ingestUpload, purgeReceiptFiles } from "./pipeline";
import { MAX_BULK_DELETE, ReceiptRepo, type ReceiptScope } from "./repository";
import { Db, Storage } from "./services";
import { ensurePersonalWorkspace } from "./workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `del-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
const limits = { perMinute: 1000, perDay: 1000 };

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  await db((d) =>
    d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
  );
  const organizationId = await run(
    ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }),
  );
  if (!organizationId) throw new Error("no workspace");
  return { userId: id, organizationId, role: "owner" } satisfies ReceiptScope;
}

const upload = async (scope: ReceiptScope, fileName: string) =>
  (await run(ingestUpload({ scope, fileName, body: JPEG, limits }))).receipt;

const existing = async (ids: string[]) =>
  (await db((d) => d.select({ id: receipts.id }).from(receipts).where(inArray(receipts.id, ids))))
    .map((row) => row.id)
    .sort();

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? (
        Cause.failureOption(exit.cause).pipe((o) => (o._tag === "Some" ? o.value : null)) as {
          _tag: string;
        } | null
      )?._tag
    : null;

describe.skipIf(!enabled)("bulk delete against Postgres + S3", () => {
  let owner: ReceiptScope;
  let other: ReceiptScope;
  /** `other`'s user as a plain member of `owner`'s workspace. */
  let asMember: ReceiptScope;

  beforeAll(async () => {
    owner = await createUser("owner");
    other = await createUser("other");
    await db((d) =>
      d.insert(member).values({
        id: `${tag}-m`,
        organizationId: owner.organizationId,
        userId: other.userId,
        role: "member",
        createdAt: new Date(),
      }),
    );
    asMember = { organizationId: owner.organizationId, userId: other.userId, role: "member" };
  });

  afterAll(async () => {
    for (const scope of [owner, other])
      await run(purgeReceiptFiles({ organizationId: scope.organizationId }));
    await db(async (d) => {
      await d
        .delete(jobs)
        .where(
          sql`${jobs.userId} like ${`${tag}%`} or ${jobs.organizationId} in (${owner.organizationId}, ${other.organizationId})`,
        );
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  it("deletes only the workspace's receipts; another workspace's ids count as not found", async () => {
    const mine = await upload(owner, "mine.jpg");
    const theirs = await upload(other, "theirs.jpg");
    const result = await run(
      deleteReceipts({ scope: owner, target: { ids: [mine.id, theirs.id, "not-a-uuid"] } }),
    );
    expect(result).toMatchObject({ deleted: 1, skipped: 0, notFound: 2 });
    expect(await existing([mine.id, theirs.id])).toEqual([theirs.id]);

    // The other way round: nothing of the owner's workspace is reachable from `other`'s.
    const kept = await upload(owner, "kept.jpg");
    const none = await run(deleteReceipts({ scope: other, target: { ids: [kept.id] } }));
    expect(none).toMatchObject({ deleted: 0, notFound: 1, jobId: null });
    expect(await existing([kept.id])).toEqual([kept.id]);
  });

  it("skips receipts a plain member may not delete and reports them", async () => {
    const owners = await upload(owner, "owners.jpg");
    const own = await upload(asMember, "members.jpg");
    const result = await run(
      deleteReceipts({ scope: asMember, target: { ids: [owners.id, own.id] } }),
    );
    expect(result).toMatchObject({ deleted: 1, skipped: 1, notFound: 0 });
    expect(await existing([owners.id, own.id])).toEqual([owners.id]);

    // An admin may delete anyone's.
    const admin = { ...asMember, role: "admin" };
    expect(await run(deleteReceipts({ scope: admin, target: { ids: [owners.id] } }))).toMatchObject(
      {
        deleted: 1,
        skipped: 0,
      },
    );
  });

  it("deletes everything matching a filter in the workspace, and nothing if the count changed", async () => {
    const q = `${tag}-trip`;
    const a = await upload(owner, `${q}-1.jpg`);
    const b = await upload(asMember, `${q}-2.jpg`);
    const unrelated = await upload(owner, "unrelated.jpg");
    const elsewhere = await upload(other, `${q}-3.jpg`);

    // The user saw 1 match; there are 2 now.
    const changed = await runExit(
      deleteReceipts({ scope: owner, target: { filters: { q }, expected: 1 } }),
    );
    expect(failureTag(changed)).toBe("Conflict");
    expect(await existing([a.id, b.id])).toEqual([a.id, b.id].sort());

    // A member deleting by filter: their own match goes, the owner's is skipped.
    const asMemberResult = await run(
      deleteReceipts({ scope: asMember, target: { filters: { q }, expected: 2 } }),
    );
    expect(asMemberResult).toMatchObject({ deleted: 1, skipped: 1, notFound: 0 });

    const result = await run(
      deleteReceipts({ scope: owner, target: { filters: { q }, expected: 1 } }),
    );
    expect(result).toMatchObject({ deleted: 1, skipped: 0 });
    expect(await existing([a.id, b.id, unrelated.id, elsewhere.id])).toEqual(
      [unrelated.id, elsewhere.id].sort(),
    );
  });

  it("refuses more than MAX_BULK_DELETE at once and deletes nothing", async () => {
    const q = `${tag}-many`;
    await db((d) =>
      d.insert(receipts).values(
        Array.from({ length: MAX_BULK_DELETE + 1 }, (_, i) => ({
          organizationId: owner.organizationId,
          userId: owner.userId,
          status: "failed" as const,
          fileName: `${q}-${i}.jpg`,
        })),
      ),
    );
    const exit = await runExit(
      deleteReceipts({ scope: owner, target: { filters: { q }, expected: MAX_BULK_DELETE + 1 } }),
    );
    expect(failureTag(exit)).toBe("InvalidInput");
    const listed = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.list(owner, { q }, { limit: 1, offset: 0 })),
    );
    expect(listed.total).toBe(MAX_BULK_DELETE + 1);
    await db((d) => d.delete(receipts).where(sql`${receipts.fileName} like ${`${q}%`}`));
  });

  it("removes the stored files with one storage.delete job, after the rows are gone", async () => {
    const first = await upload(owner, "file-1.jpg");
    const second = await upload(owner, "file-2.jpg");
    const keys = [first.imageObjectKey!, second.imageObjectKey!];
    const stored = (key: string) =>
      runExit(Effect.flatMap(Storage, (s) => s.get(key))).then(Exit.isSuccess);

    const { jobId } = await run(
      deleteReceipts({ scope: owner, target: { ids: [first.id, second.id] } }),
    );
    expect(await existing([first.id, second.id])).toEqual([]);
    const [job] = await db((d) => d.select().from(jobs).where(eq(jobs.id, jobId!)));
    expect(job).toMatchObject({
      kind: STORAGE_DELETE,
      state: "queued",
      organizationId: owner.organizationId,
      userId: null,
      receiptId: null,
    });
    expect((job!.payload as { keys: string[] }).keys.sort()).toEqual([...keys].sort());
    // Not until the job runs.
    expect(await Promise.all(keys.map(stored))).toEqual([true, true]);

    const stats = await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 30_000,
        ids: [jobId!],
        waitForRetries: false,
      }),
    );
    expect(stats.runs.find((r) => r.jobId === jobId)).toMatchObject({ outcome: "succeeded" });
    expect(await Promise.all(keys.map(stored))).toEqual([false, false]);
  });
});
