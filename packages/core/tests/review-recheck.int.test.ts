/**
 * Duplicate flags and the review-reasons recheck against real Postgres. Skipped unless
 * INTEGRATION=1; see receipts.int.test.ts for the setup.
 */
import { FIXTURE_RECEIPTS, type ReceiptExtraction } from "@receipt-ocr/ai";
import { and, eq, inArray, jobs, receipts, sql, user } from "@receipt-ocr/db";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../src/index";
import {
  JOB_REGISTRY,
  RECEIPT_RECHECK,
  RECHECK_VERSION,
  resetRecheckSchedule,
  scheduleRecheck,
  tick,
} from "../src/jobs";
import { ingestUpload } from "../src/pipeline";
import { recheckBatch } from "../src/recheck";
import { ReceiptRepo, type ReceiptScope } from "../src/repository";
import { Db } from "../src/services";
import { ensurePersonalWorkspace } from "../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));
const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
  run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);

const tag = `dup-${Date.now()}`;
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

/** An uploaded receipt, its job ended, so the test completes it with `extraction`. */
async function upload(scope: ReceiptScope) {
  const id = (await run(ingestUpload({ scope, fileName: "bill.jpg", body: JPEG, limits }))).receipt
    .id;
  await db((d) =>
    d
      .update(jobs)
      .set({ state: "dead", finishedAt: new Date() })
      .where(and(eq(jobs.receiptId, id), inArray(jobs.state, ["queued", "running"]))),
  );
  return id;
}

const complete = (scope: ReceiptScope, id: string, extraction: ReceiptExtraction) =>
  repo((r) => r.complete(id, scope, 1, extraction, "fixture", []));

async function receipt(scope: ReceiptScope, extraction: ReceiptExtraction) {
  const id = await upload(scope);
  await complete(scope, id, extraction);
  return id;
}

const reasons = async (scope: ReceiptScope, id: string) =>
  (await repo((r) => r.get(id, scope)))!.reviewReasons;

/** Every completed receipt in the database, batch by batch, as the job runs it. */
async function recheckAll() {
  let after: string | null = null;
  let changed = 0;
  do {
    const batch: Awaited<ReturnType<typeof recheckBatch>> = await db((d) => recheckBatch(d, after));
    changed += batch.changed;
    after = batch.last;
  } while (after);
  return changed;
}

/** A fixture bill whose amounts add up, unless `overrides` break them. */
const bill = (overrides: Partial<ReceiptExtraction>): ReceiptExtraction => {
  const base = { ...FIXTURE_RECEIPTS[0]!, ...overrides };
  return overrides.total === undefined
    ? base
    : { ...base, subtotal: overrides.total, tax: null, tip: null };
};

describe.skipIf(!enabled)("possible duplicates and the recheck job", () => {
  it("flags the newer copy by bill number and seller tax id, or by merchant, total and date", async () => {
    const a = await createUser("ana");
    const vat = bill({ invoiceNumber: "SI-0042", merchantTaxId: "601 234 567", total: 3701.6 });
    const first = await receipt(a, vat);
    // Read with other spacing and a misread total: the identifiers still decide.
    const second = await receipt(a, {
      ...vat,
      invoiceNumber: "si 0042",
      merchantTaxId: "601234567",
      total: 3710.6,
    });
    // Same shop and amount, another bill number: a different bill.
    const other = await receipt(a, { ...vat, invoiceNumber: "SI-0043" });
    expect(await reasons(a, first)).toEqual([]);
    expect(await reasons(a, second)).toContain("possible_duplicate");
    expect(await reasons(a, other)).not.toContain("possible_duplicate");

    const coffee = bill({ merchant: "Blue Bottle Coffee", total: 185 });
    const cup = await receipt(a, coffee);
    const again = await receipt(a, { ...coffee, merchant: "blue-bottle coffee" });
    const otherDay = await receipt(a, { ...coffee, receiptDate: "2026-10-13", dates: [] });
    expect(await reasons(a, cup)).not.toContain("possible_duplicate");
    expect(await reasons(a, again)).toContain("possible_duplicate");
    expect(await reasons(a, otherDay)).not.toContain("possible_duplicate");
    expect((await repo((r) => r.get(again, a)))?.duplicateOf).toBe(cup);
    const listed = await repo((r) => r.list(a, { status: "duplicate" }, { limit: 50, offset: 0 }));
    expect(listed.rows.map((row) => row.id).sort()).toEqual([second, again].sort());

    // Undated copies match when added within a week of each other.
    const undated = bill({ merchant: "Corner Shop", total: 12, receiptDate: null, dates: [] });
    await receipt(a, undated);
    expect(await reasons(a, await receipt(a, undated))).toContain("possible_duplicate");

    // Another workspace's copy is not a duplicate.
    const b = await createUser("ben");
    expect(await reasons(b, await receipt(b, vat))).toEqual([]);
  });

  it("an older upload read late flags the copy added after it", async () => {
    const c = await createUser("cai");
    const shop = bill({ merchant: "Late Shop", total: 99 });
    const older = await upload(c);
    const newer = await receipt(c, shop);
    expect(await reasons(c, newer)).toEqual([]);
    await complete(c, older, shop);
    expect(await reasons(c, older)).toEqual([]);
    expect(await reasons(c, newer)).toEqual(["possible_duplicate"]);
  });

  it("Not a duplicate stays cleared through a recheck, and can be undone", async () => {
    const d = await createUser("dev");
    const shop = bill({ merchant: "Twice Shop", total: 42 });
    await receipt(d, shop);
    const copy = await receipt(d, shop);
    expect(await repo((r) => r.setDuplicateDismissed(copy, d, true))).toBe(true);
    expect(await reasons(d, copy)).toEqual([]);
    await recheckAll();
    expect(await reasons(d, copy)).toEqual([]);
    expect(await repo((r) => r.setDuplicateDismissed(copy, d, false))).toBe(true);
    expect(await reasons(d, copy)).toEqual(["possible_duplicate"]);
  });

  it("recomputes old receipts' reasons without touching their review or edit times, idempotently", async () => {
    const e = await createUser("eve");
    const stored = async (id: string) =>
      (
        await db((dbc) =>
          dbc
            .select({
              reasons: receipts.reviewReasons,
              reviewedAt: receipts.reviewedAt,
              updatedAt: receipts.updatedAt,
            })
            .from(receipts)
            .where(eq(receipts.id, id)),
        )
      )[0]!;
    // Completed before the checks: no dates[] in the extraction, no date, and no reasons stored.
    const old = await receipt(
      e,
      bill({ merchant: "Old Shop", receiptDate: null, dates: undefined }),
    );
    // Backfilled by migration 0003.
    const lowConfidence = await receipt(e, bill({ merchant: "Faded Shop" }));
    // The resolver's date conflict, then a person set the date: their date and its cleared reasons win.
    const nepali = bill({
      merchant: "Kathmandu Kitchen",
      currency: "NPR",
      receiptDate: "2025-07-25",
      dates: [
        { text: "25/07/2025", label: "Date", calendar: "gregory", role: "transaction" },
        { text: "01/04/2082", label: "Miti", calendar: "bikram-sambat", role: "transaction" },
      ],
    });
    const conflicted = await receipt(e, nepali);
    const edited = await receipt(e, { ...nepali, merchant: "Patan Kitchen" });
    expect(await reasons(e, edited)).toEqual(["date_conflict"]);
    await repo((r) => r.update(edited, e, { receiptDate: "2025-07-25" }));
    await db((dbc) =>
      dbc
        .update(receipts)
        .set({ reviewReasons: sql`'{}'` })
        .where(inArray(receipts.id, [old, conflicted])),
    );
    await db((dbc) =>
      dbc
        .update(receipts)
        .set({ reviewReasons: ["low_confidence"] })
        .where(eq(receipts.id, lowConfidence)),
    );
    await repo((r) => r.setReviewed(old, e, true));
    const before = await Promise.all([old, lowConfidence, conflicted, edited].map(stored));

    await recheckAll();
    const after = await Promise.all([old, lowConfidence, conflicted, edited].map(stored));
    expect(after.map((row) => row.reasons)).toEqual([["no_date"], [], ["date_conflict"], []]);
    expect(after.map((row) => [row.reviewedAt, row.updatedAt])).toEqual(
      before.map((row) => [row.reviewedAt, row.updatedAt]),
    );
    // A reviewed receipt stays reviewed, so it stays out of Needs review.
    expect(after[0]!.reviewedAt).not.toBeNull();

    await recheckAll();
    expect(await Promise.all([old, lowConfidence, conflicted, edited].map(stored))).toEqual(after);
  });

  it("is queued once per version and runs as a job", async () => {
    const key = `${RECEIPT_RECHECK}:${RECHECK_VERSION}`;
    await db((d) => d.delete(jobs).where(eq(jobs.kind, RECEIPT_RECHECK)));
    resetRecheckSchedule();
    await run(scheduleRecheck());
    resetRecheckSchedule();
    await run(scheduleRecheck());
    const queued = await db((d) => d.select().from(jobs).where(eq(jobs.idempotencyKey, key)));
    expect(queued).toHaveLength(1);

    const f = await createUser("fay");
    const id = await receipt(
      f,
      bill({ merchant: "Job Shop", receiptDate: null, dates: undefined }),
    );
    await db((d) =>
      d
        .update(receipts)
        .set({ reviewReasons: sql`'{}'` })
        .where(eq(receipts.id, id)),
    );
    // The first run and the follow-ups it queues for the rest, until none is left.
    for (let run_ = 0; run_ < 100; run_++) {
      const live = await db((d) =>
        d
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.kind, RECEIPT_RECHECK), inArray(jobs.state, ["queued", "running"]))),
      );
      if (live.length === 0) break;
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
    const [done] = await db((d) => d.select().from(jobs).where(eq(jobs.id, queued[0]!.id)));
    expect(done?.state).toBe("succeeded");
    expect(await reasons(f, id)).toEqual(["no_date"]);

    // Finished, it is not queued again for the same version.
    resetRecheckSchedule();
    await run(scheduleRecheck());
    expect(await db((d) => d.select().from(jobs).where(eq(jobs.idempotencyKey, key)))).toHaveLength(
      1,
    );
  });
});
