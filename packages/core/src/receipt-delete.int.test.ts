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

  it("rolls a filter delete back when the rows change between the count and the delete", async () => {
    const q = `${tag}-race`;
    const kept = await upload(owner, `${q}-1.jpg`);
    const skipped = await upload(owner, `${q}-skip.jpg`);
    // Stands in for a concurrent change: the delete statement leaves one counted row alone.
    const fn = `del_race_${Date.now()}`;
    await db(async (d) => {
      await d.execute(
        sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
          begin if old.file_name = '${q}-skip.jpg' then return null; end if; return old; end $$`),
      );
      await d.execute(
        sql.raw(
          `create trigger ${fn} before delete on receipts for each row execute function ${fn}()`,
        ),
      );
    });
    try {
      const exit = await runExit(
        deleteReceipts({ scope: owner, target: { filters: { q }, expected: 2 } }),
      );
      expect(failureTag(exit)).toBe("Conflict");
      // Rolled back: the row the delete did reach is still there, and no job was queued.
      expect(await existing([kept.id, skipped.id])).toEqual([kept.id, skipped.id].sort());
      const queued = await db((d) =>
        d
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            sql`${jobs.kind} = ${STORAGE_DELETE} and ${jobs.payload}::text like ${`%${kept.imageObjectKey}%`}`,
          ),
      );
      expect(queued).toEqual([]);
    } finally {
      await db(async (d) => {
        await d.execute(sql.raw(`drop trigger if exists ${fn} on receipts`));
        await d.execute(sql.raw(`drop function if exists ${fn}()`));
      });
    }
    expect(
      await run(deleteReceipts({ scope: owner, target: { filters: { q }, expected: 2 } })),
    ).toMatchObject({ deleted: 2 });
  });

  it("sorts with missing values last in both directions and a stable id tiebreak", async () => {
    const q = `${tag}-sort`;
    const rows = await db((d) =>
      d
        .insert(receipts)
        .values(
          [
            { merchant: "beta", total: "5.00", receiptDate: "2026-01-02" },
            { merchant: "Alpha", total: "5.00", receiptDate: "2026-01-02" },
            { merchant: null, total: null, receiptDate: null },
            { merchant: "gamma", total: "9.00", receiptDate: "2026-01-01" },
          ].map((row, i) => ({
            ...row,
            organizationId: owner.organizationId,
            userId: owner.userId,
            status: "completed" as const,
            fileName: `${q}-${i}.jpg`,
          })),
        )
        .returning({ id: receipts.id, fileName: receipts.fileName }),
    );
    const name = new Map(rows.map((r) => [r.id, r.fileName!.slice(q.length + 1, -4)]));
    const order = async (by: "date" | "total" | "merchant", dir: "asc" | "desc") =>
      (
        await run(
          Effect.flatMap(ReceiptRepo, (r) =>
            r.list(owner, { q }, { limit: 10, offset: 0, sort: { by, dir } }),
          ),
        )
      ).rows.map((row) => name.get(row.id));
    const [b, a] = [rows[0]!.id, rows[1]!.id];
    // Equal keys (beta and Alpha share total and date) fall back to the id, in the same direction.
    const tie = (dir: "asc" | "desc") =>
      (dir === "asc" ? a < b : a > b) ? ["1", "0"] : ["0", "1"];
    expect(await order("merchant", "asc")).toEqual(["1", "0", "3", "2"]);
    expect(await order("merchant", "desc")).toEqual(["3", "0", "1", "2"]);
    expect(await order("total", "desc")).toEqual(["3", ...tie("desc"), "2"]);
    expect(await order("total", "asc")).toEqual([...tie("asc"), "3", "2"]);
    expect(await order("date", "asc")).toEqual(["3", ...tie("asc"), "2"]);
    // Paging the same order never repeats or skips a row.
    const paged = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const page = await run(
        Effect.flatMap(ReceiptRepo, (r) =>
          r.list(owner, { q }, { limit: 1, offset, sort: { by: "total", dir: "desc" } }),
        ),
      );
      paged.push(name.get(page.rows[0]!.id));
    }
    expect(paged).toEqual(await order("total", "desc"));
    await db((d) => d.delete(receipts).where(sql`${receipts.fileName} like ${`${q}%`}`));
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
