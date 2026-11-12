/**
 * Integration tests against real Postgres and S3 (RustFS locally). Skipped
 * unless INTEGRATION=1; run with `bun run --filter @receipt-ocr/core test:int`
 * after `bun run db:migrate`, with DATABASE_URL and S3_* set and
 * OCR_PROVIDER=fixture.
 */
import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS } from "@receipt-ocr/ai";
import {
  and,
  eq,
  inArray,
  jobs,
  member,
  ocrCalls,
  ocrRounds,
  organization,
  receipts,
  sql,
  user,
} from "@receipt-ocr/db";
import { Cause, Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "./index";
import { JOB_REGISTRY, tick } from "./jobs";
import { classifyExtractionError } from "./jobs/kinds/receipt-extract";
import { claimRetry, deleteReceipt, ingestUpload, purgeReceiptFiles } from "./pipeline";
import { FREE_FAILED_ROUNDS } from "./plans";
import { checkQuota, quotaGate, usageWindow } from "./quota";
import { ReceiptRepo, STALE_AFTER_MS } from "./repository";
import { Db, Storage } from "./services";
import { addEventSink, type EventRecord } from "./telemetry";
import { receiptCalls, usageByDay, usageByModel, usageByWorkspace } from "./usage";
import { ensurePersonalWorkspace, clearRateLimit, hitRateLimit, resolveScope } from "./workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);

const tag = `int-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
const FAILING_JPEG = new Uint8Array([...JPEG, ...new TextEncoder().encode(FIXTURE_FAIL_MARKER)]);
/** Room for everything the suite uploads; quota tests pass their own limits. */
const limits = { perMinute: 1000, perDay: 1000 };
const gate = () => run(quotaGate(limits));
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

/**
 * Runs the receipt's live job to the end, skipping its backoff waits: a
 * failing fixture read is retried until the job is dead.
 */
async function extract(receiptId: string) {
  for (let i = 0; i < 10; i++) {
    const [live] = await db((d) =>
      d
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.receiptId, receiptId), inArray(jobs.state, ["queued", "running"]))),
    );
    if (!live) return;
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(0) })
        .where(eq(jobs.id, live.id)),
    );
    await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 60_000,
        ids: [live.id],
        waitForRetries: false,
      }),
    );
  }
  throw new Error(`receipt ${receiptId}'s job never finished`);
}

/**
 * `extract` with a single attempt: the receipt's job dies on its first failure.
 * For tests about rounds (quota), where retries only add work: a round is one
 * failed read however many attempts it took.
 */
async function extractOnce(receiptId: string) {
  await db((d) =>
    d
      .update(jobs)
      .set({ maxAttempts: 1 })
      .where(and(eq(jobs.receiptId, receiptId), inArray(jobs.state, ["queued", "running"]))),
  );
  await extract(receiptId);
}

/** Ends a receipt's live job without running it, as a lost final write would leave it. */
const dropJob = (receiptId: string) =>
  db((d) =>
    d
      .update(jobs)
      .set({ state: "dead", finishedAt: new Date() })
      .where(and(eq(jobs.receiptId, receiptId), inArray(jobs.state, ["queued", "running"]))),
  );

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
    const ingested = await run(
      ingestUpload({ scope: a, fileName: "lunch.jpg", body: JPEG, limits }),
    );
    receiptId = ingested.receipt.id;
    objectKey = ingested.receipt.imageObjectKey!;
    await extract(receiptId);
  });

  afterAll(async () => {
    for (const owner of [a, b])
      await run(purgeReceiptFiles({ organizationId: owner.organizationId }));
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use(async (db) => {
          await db.delete(ocrCalls).where(sql`${ocrCalls.userId} like ${`${tag}%`}`);
          await db.delete(ocrRounds).where(sql`${ocrRounds.userId} like ${`${tag}%`}`);
          await db.delete(jobs).where(sql`${jobs.userId} like ${`${tag}%`}`);
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

  it("U4b: picks a fresh slug when the id-based slug belongs to an org the user is not in", async () => {
    const id = `${tag}-squatted`;
    await run(
      Effect.flatMap(Db, ({ use }) =>
        use(async (db) => {
          await db
            .insert(user)
            .values({ id, name: "Sq", email: `${id}@example.com`, emailVerified: true });
          await db
            .insert(organization)
            .values({ id: crypto.randomUUID(), name: "Squatter", slug: id, createdAt: new Date() });
        }),
      ),
    );
    expect(await run(resolveScope(id))).toBeNull();
    const orgId = await run(ensurePersonalWorkspace({ id, email: `${id}@example.com` }));
    expect(orgId).toBeTruthy();
    expect(await run(resolveScope(id))).toMatchObject({ organizationId: orgId, role: "owner" });
    expect(await run(ensurePersonalWorkspace({ id, email: `${id}@example.com` }))).toBeNull();
  });

  it("stores only plausible dates and ISO currencies; edits outside the date bounds are refused", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    // Its own workspace, so the other tests' counts don't see these receipts.
    const c = await createUser("carol");
    const complete = async (receiptDate: string | null, currency: string) => {
      const id = (await run(ingestUpload({ scope: c, fileName: "d.jpg", body: JPEG, limits })))
        .receipt.id;
      await dropJob(id);
      const extraction = { ...FIXTURE_RECEIPTS[0]!, receiptDate, currency };
      return repo((r) => r.complete(id, c, 1, extraction, "fixture", []));
    };
    expect(await complete(" 2026-01-31 ", "eur")).toMatchObject({
      receiptDate: "2026-01-31",
      currency: "EUR",
    });
    // Not a real day, after the upload, before 2000: no date, and a reason.
    for (const date of ["2026-02-30", "2099-01-01", "1999-12-31"]) {
      const row = await complete(date, "USD");
      expect([row?.receiptDate, row?.reviewReasons]).toEqual([null, ["date_implausible"]]);
    }
    // A Bikram Sambat date the model returned as AD is converted, and marked BS.
    expect(await complete("2080-04-09", "NPR")).toMatchObject({
      receiptDate: "2023-07-25",
      receiptDateCalendar: "bikram-sambat",
    });
    expect((await complete(null, "US$"))?.currency).toBeNull();

    const row = await complete("2026-01-31", "USD");
    const id = row!.id;
    const latest = new Date(row!.createdAt.getTime() + 86_400_000).toISOString().slice(0, 10);
    const update = (receiptDate: string) =>
      runExit(Effect.flatMap(ReceiptRepo, (r) => r.update(id, c, { receiptDate })));
    expect(await update(latest)).toMatchObject({ _tag: "Success", value: true });
    expect((await repo((r) => r.get(id, c)))?.receiptDate).toBe(latest);
    for (const bad of ["2026-02-30", "1999-12-31", "2099-01-01"]) {
      const exit = await update(bad);
      expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
    }
    expect((await repo((r) => r.get(id, c)))?.receiptDate).toBe(latest);

    // The table refuses what slips past the code.
    const write = (set: Record<string, unknown>) =>
      db(async (d) => {
        try {
          await d.update(receipts).set(set).where(eq(receipts.id, id));
          return "ok";
        } catch (error) {
          // Drizzle wraps the driver's error; the constraint is on the cause.
          for (let e = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
            const name = (e as { constraint?: string }).constraint;
            if (name) return name;
          }
          throw error;
        }
      });
    expect(await write({ receiptDate: "2099-01-01" })).toBe("receipts_receipt_date_check");
    expect(await write({ currency: "usd" })).toBe("receipts_currency_check");
    expect(await write({ attempts: 4 })).toBe("receipts_attempts_check");
    await run(purgeReceiptFiles({ organizationId: c.organizationId }));
  });

  it("stores extraction v3's fields, the printed item order and the review reasons; edits recompute them", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const d = await createUser("dave");
    const ingest = async () => {
      const id = (await run(ingestUpload({ scope: d, fileName: "v3.jpg", body: JPEG, limits })))
        .receipt.id;
      await dropJob(id);
      return id;
    };
    const names = Array.from({ length: 12 }, (_, i) => `Line ${String(i).padStart(2, "0")}`);
    const id = await ingest();
    // A Nepali restaurant bill as extraction v3 would return it: the Miti disagrees with the AD date.
    const extraction = {
      ...FIXTURE_RECEIPTS[0]!,
      currency: "NPR",
      subtotal: 1000,
      tax: 128.7,
      tip: null,
      total: 1118.7,
      items: names
        .map((name) => ({ name, quantity: 1, unitPrice: 0, totalPrice: 0, confidence: 0.9 }))
        .reverse(),
      receiptDate: "2025-07-25",
      dates: [
        { text: "25/07/2025", label: "Date", calendar: "ad", role: "transaction" },
        { text: "01/04/2082", label: "Miti", calendar: "bs", role: "transaction" },
      ],
      invoiceNumber: "SI-0042-82/83",
      merchantTaxId: "601234567",
      discount: -100,
      serviceCharge: 90,
    };
    const done = await repo((r) => r.complete(id, d, 1, extraction, "fixture", []));
    expect(done).toMatchObject({
      receiptDate: "2025-07-17",
      receiptDateCalendar: "bikram-sambat",
      invoiceNumber: "SI-0042-82/83",
      merchantTaxId: "601234567",
      discount: "100.00",
      serviceCharge: "90.00",
      reviewReasons: ["date_conflict"],
    });
    const stored = await repo((r) => r.get(id, d));
    expect(stored!.items.map((item) => item.name)).toEqual([...names].reverse());
    expect(stored!.items.map((item) => item.position)).toEqual(names.map((_, i) => i));

    const needsReview = async () => ({
      count: (await repo((r) => r.counts(d))).needsReview,
      listed: (await repo((r) => r.list(d, { status: "needs-review" }, { limit: 50, offset: 0 })))
        .total,
    });
    expect(await needsReview()).toEqual({ count: 1, listed: 1 });

    // An edit that leaves the date keeps the date reason, and adds what the edit breaks.
    expect(await repo((r) => r.update(id, d, { total: "999.00" }))).toBe(true);
    expect((await repo((r) => r.get(id, d)))?.reviewReasons).toEqual([
      "totals_mismatch",
      "date_conflict",
    ]);
    // Re-sending the same date is not a change; setting it is, and clears the date reason.
    await repo((r) => r.update(id, d, { receiptDate: "2025-07-17", total: "1118.70" }));
    expect((await repo((r) => r.get(id, d)))?.reviewReasons).toEqual(["date_conflict"]);
    await repo((r) =>
      r.update(id, d, { receiptDate: "2025-07-25", receiptDateCalendar: "gregory" }),
    );
    expect(await repo((r) => r.get(id, d))).toMatchObject({
      receiptDate: "2025-07-25",
      receiptDateCalendar: "gregory",
      reviewReasons: [],
    });
    expect(await needsReview()).toEqual({ count: 0, listed: 0 });
    // Clearing the date clears its calendar, and the receipt needs review again.
    await repo((r) => r.update(id, d, { receiptDate: null }));
    expect(await repo((r) => r.get(id, d))).toMatchObject({
      receiptDate: null,
      receiptDateCalendar: null,
      reviewReasons: ["no_date"],
    });

    // The model took the PAN for the bill number: it is dropped. Over-long text is not stored.
    const other = await ingest();
    const pan = await repo((r) =>
      r.complete(
        other,
        d,
        1,
        { ...extraction, invoiceNumber: "PAN 601 234 567", merchantTaxId: "x".repeat(33) },
        "fixture",
        [],
      ),
    );
    expect([pan?.invoiceNumber, pan?.merchantTaxId]).toEqual(["PAN 601 234 567", null]);
    const same = await ingest();
    const dropped = await repo((r) =>
      r.complete(same, d, 1, { ...extraction, invoiceNumber: "601-234-567" }, "fixture", []),
    );
    expect(dropped?.invoiceNumber).toBeNull();

    // The new columns' checks hold whatever writes them.
    const write = (set: Record<string, unknown>) =>
      db(async (dbc) => {
        try {
          await dbc.update(receipts).set(set).where(eq(receipts.id, id));
          return "ok";
        } catch (error) {
          for (let e = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
            const name = (e as { constraint?: string }).constraint;
            if (name) return name;
          }
          throw error;
        }
      });
    expect(await write({ receiptDateCalendar: "bs" })).toBe("receipts_receipt_date_calendar_check");
    expect(await write({ discount: "-1" })).toBe("receipts_discount_check");
    expect(await write({ serviceCharge: "-1" })).toBe("receipts_service_charge_check");
    expect(await write({ invoiceNumber: "" })).toBe("receipts_invoice_number_check");
    expect(await write({ merchantTaxId: "x".repeat(33) })).toBe("receipts_merchant_tax_id_check");
    await run(purgeReceiptFiles({ organizationId: d.organizationId }));
  });

  it("completes through the fixture provider with a canonical category", async () => {
    const receipt = await run(Effect.flatMap(ReceiptRepo, (repo) => repo.get(receiptId, a)));
    expect(receipt?.status).toBe("completed");
    expect(receipt?.items.length).toBeGreaterThan(0);
    expect(receipt?.fileName).toBe("lunch.jpg");
    const [exported] = await run(Effect.flatMap(ReceiptRepo, (repo) => repo.exportRows(a, {}, 10)));
    expect(exported?.itemCount).toBe(receipt?.items.length);
  });

  it("an impersonated upload's job carries the admin into its attempt event", async () => {
    const records: EventRecord[] = [];
    const remove = addEventSink({
      write: (record) => void records.push(record),
      flush: async () => {},
      shutdown: async () => {},
    });
    // Its own user, so the receipt doesn't change other tests' counts.
    const d = await createUser("dana");
    try {
      const ingested = await run(
        ingestUpload({
          scope: { ...d, impersonatedBy: `${tag}-admin` },
          fileName: "support.jpg",
          body: JPEG,
          limits,
        }),
      );
      const [job] = await db((d) =>
        d.select({ payload: jobs.payload }).from(jobs).where(eq(jobs.id, ingested.jobId)),
      );
      expect(job?.payload).toMatchObject({ impersonatedBy: `${tag}-admin` });
      await extract(ingested.receipt.id);
    } finally {
      remove();
    }
    const attempt = records.find((r) => r.event === "job.attempt");
    expect(attempt).toMatchObject({ user_id: d.userId, impersonated_by: `${tag}-admin` });
    await run(purgeReceiptFiles({ organizationId: d.organizationId }));
  });

  it("workspace isolation: org B cannot read, list, export, edit, retry or delete org A's receipt", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f));
    const g = await gate();
    expect(await repo((r) => r.get(receiptId, b))).toBeNull();
    expect((await repo((r) => r.list(b, {}, { limit: 50, offset: 0 }))).total).toBe(0);
    const recent = await repo((r) => r.list(a, {}, { limit: 50, offset: 0, total: false }));
    expect(recent.total).toBeNull();
    expect(recent.rows.map((row) => row.id)).toContain(receiptId);
    expect(await repo((r) => r.exportRows(b, {}, 50))).toEqual([]);
    expect(await repo((r) => r.update(receiptId, b, { merchant: "pwned" }))).toBe(false);
    expect(await repo((r) => r.claimRetry(receiptId, b, g))).toEqual({ kind: "not-found" });
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

  it("P2-5: owners and admins edit or delete any receipt; a member only their own", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const asRole = (role: string) => ({ organizationId: a.organizationId, userId: b.userId, role });
    const seed = async () =>
      (await run(ingestUpload({ scope: a, fileName: "policy.jpg", body: JPEG, limits }))).receipt
        .id;
    const removed = async (id: string, scope: ReturnType<typeof asRole>) => {
      const result = await repo((r) => r.removeMany(scope, { ids: [id] }));
      return result.kind === "deleted" ? result.deleted.length : -1;
    };

    // Member: neither edit nor delete Alice's receipt, but both on their own upload.
    const alices = await seed();
    expect(
      await repo((r) => r.update(alices, asRole("member"), { merchant: "=HYPERLINK()" })),
    ).toBe(false);
    expect(await removed(alices, asRole("member"))).toBe(0);
    expect((await repo((r) => r.get(alices, a)))?.merchant).not.toBe("=HYPERLINK()");
    const own = (
      await run(ingestUpload({ scope: asRole("member"), fileName: "m.jpg", body: JPEG, limits }))
    ).receipt.id;
    expect(await repo((r) => r.update(own, asRole("member"), { merchant: "Mine" }))).toBe(true);
    expect(await removed(own, asRole("member"))).toBe(1);

    // No role at all fails closed.
    expect(await repo((r) => r.update(alices, { ...asRole("x"), role: undefined }, {}))).toBe(
      false,
    );

    // Admin and owner: anyone's.
    for (const role of ["admin", "owner"]) {
      const id = await seed();
      expect(await repo((r) => r.update(id, asRole(role), { merchant: `By ${role}` }))).toBe(true);
      expect(await removed(id, asRole(role))).toBe(1);
    }
    await run(deleteReceipt({ receiptId: alices, scope: a }));
  });

  it("L3: a non-UUID receipt id is simply not found", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    expect(await repo((r) => r.get("not-a-uuid", a))).toBeNull();
    expect(await repo((r) => r.update("not-a-uuid", a, { merchant: "x" }))).toBe(false);
    expect(await repo((r) => r.removeMany(a, { ids: ["not-a-uuid"] }))).toMatchObject({
      deleted: [],
      notFound: 1,
    });
    const g = await gate();
    expect(await repo((r) => r.claimRetry("not-a-uuid", a, g))).toEqual({ kind: "not-found" });
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
    // Not a day: ignored rather than failing the date cast.
    expect((await list({ from: "2026-02-30" })).total).toBe((await list({})).total);
    const needsReview = receipt!.reviewReasons.length > 0 ? 1 : 0;
    expect((await list({ status: "needs-review" })).total).toBe(needsReview);
    const counts = await run(Effect.flatMap(ReceiptRepo, (r) => r.counts(a)));
    expect(counts.needsReview).toBe(needsReview);
    expect(counts.total).toBe((await list({})).total);
  });

  it("a review takes a receipt out of needs-review until it is read again; only editors can review", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const needsReview = async () => ({
      count: (await repo((r) => r.counts(a))).needsReview,
      listed: (await repo((r) => r.list(a, { status: "needs-review" }, { limit: 50, offset: 0 })))
        .total,
    });
    const id = (await run(ingestUpload({ scope: a, fileName: "review.jpg", body: JPEG, limits })))
      .receipt.id;
    await extract(id);
    // The fixture read picks a receipt by the upload's bytes; set the state under test directly.
    const set = (values: Partial<typeof receipts.$inferInsert>) =>
      db((d) => d.update(receipts).set(values).where(eq(receipts.id, id)));
    await set({ reviewReasons: [] });
    const before = await needsReview();
    // No merchant: edits recompute the reasons, and this one stays.
    await set({ merchant: null, reviewReasons: ["no_merchant"] });
    const low = await needsReview();
    expect(low).toEqual({ count: before.count + 1, listed: before.listed! + 1 });

    // A plain member who didn't upload it, and another workspace, can't review it.
    const member = { organizationId: a.organizationId, userId: b.userId, role: "member" };
    expect(await repo((r) => r.setReviewed(id, member, true))).toBe(false);
    expect(await repo((r) => r.setReviewed(id, b, true))).toBe(false);
    expect(await needsReview()).toEqual(low);

    expect(await repo((r) => r.setReviewed(id, a, true))).toBe(true);
    expect(await needsReview()).toEqual(before);
    const reviewed = await repo((r) => r.get(id, a));
    expect(reviewed?.reviewedBy).toBe(a.userId);
    expect(reviewed?.reviewedAt).toBeInstanceOf(Date);
    expect(reviewed?.reviewer?.name).toBe("alice");

    // An edit keeps the review; undo clears it.
    expect(await repo((r) => r.update(id, a, { category: "Other" }))).toBe(true);
    expect((await repo((r) => r.get(id, a)))?.reviewedAt).toBeInstanceOf(Date);
    expect(await repo((r) => r.setReviewed(id, a, false))).toBe(true);
    const undone = await repo((r) => r.get(id, a));
    expect([undone?.reviewedAt, undone?.reviewedBy, undone?.reviewer]).toEqual([null, null, null]);
    expect(await needsReview()).toEqual(low);

    // A new extraction clears the review.
    expect(await repo((r) => r.setReviewed(id, a, true))).toBe(true);
    await db((d) => d.update(receipts).set({ status: "processing" }).where(eq(receipts.id, id)));
    const extraction = { ...FIXTURE_RECEIPTS[0]!, merchant: "" };
    expect(await repo((r) => r.complete(id, a, 1, extraction, "fixture", []))).not.toBeNull();
    const reread = await repo((r) => r.get(id, a));
    expect([reread?.reviewedAt, reread?.reviewedBy]).toEqual([null, null]);
    expect(await needsReview()).toEqual(low);

    await run(deleteReceipt({ receiptId: id, scope: a }));
  });

  it("a review needs a completed receipt; an admin can review a member's upload, and an impersonating admin is the reviewer", async () => {
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const member = { organizationId: a.organizationId, userId: b.userId, role: "member" };
    const admin = { organizationId: a.organizationId, userId: a.userId, role: "admin" };
    const id = (
      await run(ingestUpload({ scope: member, fileName: "members.jpg", body: JPEG, limits }))
    ).receipt.id;

    // Still processing: even its uploader can't review it yet.
    expect(await repo((r) => r.setReviewed(id, member, true))).toBe(false);
    await extract(id);

    expect(await repo((r) => r.setReviewed(id, admin, true))).toBe(true);
    expect((await repo((r) => r.get(id, a)))?.reviewedBy).toBe(a.userId);

    expect(
      await repo((r) => r.setReviewed(id, { ...member, impersonatedBy: a.userId }, true)),
    ).toBe(true);
    const impersonated = await repo((r) => r.get(id, a));
    expect(impersonated?.reviewedBy).toBe(a.userId);
    expect(impersonated?.reviewer?.name).toBe("alice");
    expect(await repo((r) => r.setReviewed(id, member, true))).toBe(true);
    expect((await repo((r) => r.get(id, a)))?.reviewedBy).toBe(b.userId);

    await run(deleteReceipt({ receiptId: id, scope: admin }));
  });

  it("U2: a receipt stuck in processing with no live job reads as failed and stops counting against quota", async () => {
    const stuck = await run(ingestUpload({ scope: a, fileName: "stuck.jpg", body: JPEG, limits }));
    const before = await run(checkQuota(a, limits));
    await db((d) =>
      d
        .update(receipts)
        .set({ updatedAt: new Date(Date.now() - STALE_AFTER_MS - 1000) })
        .where(eq(receipts.id, stuck.receipt.id)),
    );
    // Waiting in the queue, however long, is not stale.
    expect(
      (await run(Effect.flatMap(ReceiptRepo, (r) => r.get(stuck.receipt.id, a))))?.status,
    ).toBe("processing");
    await dropJob(stuck.receipt.id);
    // Its round in the ledger aged out too (the function was killed: no calls were written).
    await db((d) =>
      d
        .update(ocrRounds)
        .set({ createdAt: new Date(Date.now() - STALE_AFTER_MS - 1000) })
        .where(eq(ocrRounds.receiptId, stuck.receipt.id)),
    );
    const read = await run(Effect.flatMap(ReceiptRepo, (r) => r.get(stuck.receipt.id, a)));
    expect(read?.status).toBe("failed");
    const failedRows = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.list(a, { status: "failed" }, { limit: 50, offset: 0 })),
    );
    expect(failedRows.rows.map((row) => row.id)).toContain(stuck.receipt.id);
    expect((await run(checkQuota(a, limits))).used).toBe(before.used - 1);
    // Fresh in-flight receipts: the processing filter matches Home's "Reading now" count.
    const fresh = await run(
      ingestUpload({ scope: a, fileName: "fresh.jpg", body: new Uint8Array([...JPEG, 1]), limits }),
    );
    const reading = await run(
      Effect.flatMap(ReceiptRepo, (r) =>
        r.list(a, { status: "processing" }, { limit: 50, offset: 0 }),
      ),
    );
    const inFlight = await run(Effect.flatMap(ReceiptRepo, (r) => r.counts(a)));
    expect(reading.total).toBe(inFlight.inFlight);
    expect(reading.rows.map((row) => row.id)).toContain(fresh.receipt.id);
    const g = await gate();
    expect(
      await run(Effect.flatMap(ReceiptRepo, (r) => r.claimRetry(stuck.receipt.id, a, g))),
    ).toMatchObject({
      kind: "claimed",
    });
  });

  let g: Awaited<ReturnType<typeof gate>>;
  beforeAll(async () => {
    g = await gate();
  });

  it("retries count against the burst and global windows, and stop after the attempt cap", async () => {
    const failing = await run(
      ingestUpload({ scope: a, fileName: "blurry.jpg", body: JPEG, limits }),
    );
    const id = failing.receipt.id;
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const window = () => usageWindow(new Date(), true);
    let attempt = 1;
    const markFailed = () => repo((r) => r.fail(id, a, attempt, "unreadable", []));

    await markFailed();
    const before = await repo((r) => r.usage(a, window()));
    expect(await repo((r) => r.claimRetry(id, a, g))).toMatchObject({ kind: "claimed" });
    attempt += 1;
    const after = await repo((r) => r.usage(a, window()));
    expect(after.userMinute).toBe(before.userMinute + 1);
    expect(after.globalDay).toBe((before.globalDay ?? 0) + 1);

    await markFailed();
    expect(await repo((r) => r.claimRetry(id, a, g))).toMatchObject({ kind: "claimed" });
    attempt += 1;
    await markFailed();
    expect(await repo((r) => r.claimRetry(id, a, g))).toEqual({ kind: "attempts-exhausted" });
  });

  it("only the current attempt can complete or fail a receipt; every run's calls are kept", async () => {
    const fresh = await run(ingestUpload({ scope: a, fileName: "race.jpg", body: JPEG, limits }));
    const id = fresh.receipt.id;
    const repo = <A>(f: (r: typeof ReceiptRepo.Service) => Effect.Effect<A, unknown>) =>
      run(Effect.flatMap(ReceiptRepo, f) as Effect.Effect<A, never, AppServices>);
    const extraction = FIXTURE_RECEIPTS[0]!;
    const call = (round: number) => ({
      receiptId: id,
      organizationId: a.organizationId,
      userId: a.userId,
      round,
      step: 0,
      model: "fixture",
      provider: "fixture",
      status: "ok" as const,
      latencyMs: 5,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costMicroUsd: 0,
      priceFrom: "2000-01-01",
    });

    // Attempt 1 times out and fails, a retry claims attempt 2.
    expect(await repo((r) => r.fail(id, a, 1, "slow", []))).toBe(true);
    expect(await repo((r) => r.claimRetry(id, a, g))).toMatchObject({ kind: "claimed" });

    // The stale attempt 1 finishing late can neither complete nor fail attempt 2,
    // but the call it made is still recorded.
    expect(await repo((r) => r.complete(id, a, 1, extraction, "fixture", [call(1)]))).toBeNull();
    expect(await repo((r) => r.fail(id, a, 1, "late", []))).toBe(false);
    expect((await repo((r) => r.get(id, a)))?.status).toBe("processing");

    expect(
      await repo((r) => r.complete(id, a, 2, extraction, "fixture", [call(2)])),
    ).not.toBeNull();
    // A duplicate completion or a late failure cannot touch the finished receipt.
    const other = { ...extraction, merchant: "Overwritten" };
    expect(await repo((r) => r.complete(id, a, 2, other, "fixture", []))).toBeNull();
    expect(await repo((r) => r.fail(id, a, 2, "dup", []))).toBe(false);
    expect(await repo((r) => r.get(id, a))).toMatchObject({
      status: "completed",
      merchant: extraction.merchant,
    });
    // The same round's calls written again (a lost COMMIT ack, then the failure path) count once.
    expect(await repo((r) => r.fail(id, a, 2, "again", [call(2)]))).toBe(false);
    const calls = await run(receiptCalls(id, a.organizationId));
    expect(calls.map((c) => c.round)).toEqual([1, 2]);
  });

  it("completes a misread too large for its columns, with those amounts left unread", async () => {
    const fresh = await run(ingestUpload({ scope: a, fileName: "huge.jpg", body: JPEG, limits }));
    const id = fresh.receipt.id;
    await dropJob(id);
    const base = FIXTURE_RECEIPTS[0]!;
    const extraction = {
      ...base,
      subtotal: 12.5,
      tax: 4111111111111111,
      total: 1e12,
      items: [{ name: "Card no.", quantity: 1e12, unitPrice: 1e12, totalPrice: 3, confidence: 1 }],
    };
    const completed = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.complete(id, a, 1, extraction, "fixture", [])),
    );
    expect(completed).toMatchObject({
      status: "completed",
      subtotal: "12.50",
      tax: null,
      total: null,
    });
    expect(completed?.items).toMatchObject([{ quantity: 1, unitPrice: null, totalPrice: "3.00" }]);
  });

  it("a value Postgres refuses on complete ends the job instead of retrying it", async () => {
    const fresh = await run(ingestUpload({ scope: a, fileName: "nul.jpg", body: JPEG, limits }));
    const id = fresh.receipt.id;
    await dropJob(id);
    // Postgres text can't hold a NUL: invalid byte sequence, SQLSTATE 22021.
    const extraction = { ...FIXTURE_RECEIPTS[0]!, merchant: "a\u0000b" };
    const exit = await runExit(
      Effect.flatMap(ReceiptRepo, (r) => r.complete(id, a, 1, extraction, "fixture", [])),
    );
    if (!Exit.isFailure(exit)) throw new Error("complete() should have failed");
    const error = Cause.failureOption(exit.cause);
    if (error._tag !== "Some") throw new Error("expected a typed failure");
    expect(classifyExtractionError(error.value)).toMatchObject({
      _tag: "NonRetryableJobError",
      kind: "db-data-error",
    });
  });

  it("U1: deleting a receipt deletes its stored object", async () => {
    const storage = <A>(f: (s: typeof Storage.Service) => Effect.Effect<A, unknown>) =>
      runExit(Effect.flatMap(Storage, f));
    expect(Exit.isSuccess(await storage((s) => s.get(objectKey)))).toBe(true);
    const { jobId } = await run(deleteReceipt({ receiptId, scope: a }));
    // The row is gone at once; the file goes with the `storage.delete` job.
    expect(Exit.isSuccess(await storage((s) => s.get(objectKey)))).toBe(true);
    await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 60_000,
        ids: [jobId!],
        waitForRetries: false,
      }),
    );
    expect(Exit.isFailure(await storage((s) => s.get(objectKey)))).toBe(true);
  });

  describe("usage ledger", () => {
    const usedToday = (subject: typeof a, l = limits) =>
      run(checkQuota(subject, l)).then((v) => v.used);
    const readAndExtract = async (scope: typeof a, body = JPEG) => {
      const { receipt } = await run(ingestUpload({ scope, fileName: "r.jpg", body, limits }));
      await extract(receipt.id);
      return receipt.id;
    };

    it("P0-1: deleting a receipt gives back neither the user's quota nor the global count", async () => {
      const c = await createUser("deleter");
      const id = await readAndExtract(c);
      expect(await usedToday(c)).toBe(1);
      const before = await run(
        Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))),
      );
      await run(deleteReceipt({ receiptId: id, scope: c }));
      expect(await usedToday(c)).toBe(1);
      const after = await run(
        Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))),
      );
      expect(after).toEqual(before);
    });

    it("a failed read costs no quota but counts toward the global cap, and so do its retries", async () => {
      const c = await createUser("failer");
      const window = () => usageWindow(new Date(), true);
      const usage = () => run(Effect.flatMap(ReceiptRepo, (r) => r.usage(c, window())));
      const start = await usage();
      const id = await readAndExtract(c, FAILING_JPEG);
      await run(claimRetry({ receiptId: id, scope: c, limits }));
      await extract(id);
      const end = await usage();
      expect(end.day).toBe(start.day);
      // Two rounds, however many automatic attempts each took.
      expect(end.userMinute).toBe(start.userMinute + 2);
      expect(end.globalDay! - start.globalDay!).toBeGreaterThanOrEqual(2);
      const calls = await run(receiptCalls(id, c.organizationId));
      expect(calls.map((call) => [call.round, call.jobAttempt, call.status])).toEqual(
        [1, 2].flatMap((round) =>
          [1, 2, 3, 4].map((attempt) => [round, attempt, "provider-error"]),
        ),
      );
    });

    // Many uploads in a row: given room for CI, where `next build` runs alongside these tests.
    it(
      "M1: failed reads past the free allowance count toward the day",
      { timeout: 20_000 },
      async () => {
        const c = await createUser("junk");
        const tight = { perMinute: 1000, perDay: 20 };
        const upload = () =>
          runExit(ingestUpload({ scope: c, fileName: "j.jpg", body: FAILING_JPEG, limits: tight }));
        // used = max(0, failed − FREE_FAILED_ROUNDS): 25 failures fit under 20, the 26th upload doesn't.
        for (let i = 0; i < 20 + FREE_FAILED_ROUNDS; i++) {
          const exit = await upload();
          if (!Exit.isSuccess(exit)) throw new Error(`upload ${i + 1} was refused`);
          await extractOnce(exit.value.receipt.id);
        }
        expect(await usedToday(c, tight)).toBe(20);
        const refused = await upload();
        expect(Exit.isFailure(refused) && JSON.stringify(refused.cause)).toContain("QuotaExceeded");
      },
    );

    it("M1: successful and failed reads together", { timeout: 20_000 }, async () => {
      const c = await createUser("mixed");
      const tight = { perMinute: 1000, perDay: 3 };
      const read = async (body: Uint8Array) => {
        const exit = await runExit(
          ingestUpload({ scope: c, fileName: "m.jpg", body, limits: tight }),
        );
        if (Exit.isSuccess(exit)) await extractOnce(exit.value.receipt.id);
        return exit;
      };
      for (const body of [JPEG, JPEG]) expect(Exit.isSuccess(await read(body))).toBe(true);
      // The free failures leave the day at 2; the sixth failure makes it 3.
      for (let i = 0; i < FREE_FAILED_ROUNDS + 1; i++) {
        expect(Exit.isSuccess(await read(FAILING_JPEG))).toBe(true);
      }
      expect(await usedToday(c, tight)).toBe(3);
      expect(Exit.isFailure(await read(JPEG))).toBe(true);
    });

    it("P2-3: a round that fails before any model call is recorded and stops reading as in flight", async () => {
      const c = await createUser("no-file");
      const { receipt } = await run(
        ingestUpload({ scope: c, fileName: "n.jpg", body: JPEG, limits }),
      );
      expect(await usedToday(c)).toBe(1); // in flight
      await run(Effect.flatMap(Storage, (s) => s.remove([receipt.imageObjectKey!])));
      await extract(receipt.id);
      expect(await usedToday(c)).toBe(0);
      const rows = await db((d) =>
        d.select().from(ocrCalls).where(eq(ocrCalls.receiptId, receipt.id)),
      );
      // One no-model row per automatic attempt (the object may come back).
      expect(rows).toHaveLength(4);
      expect(rows[0]).toMatchObject({ model: null, status: "storage-error", costMicroUsd: 0 });
      // Not a model call: rollups leave it out.
      const days = await run(
        usageByDay({ organizationId: c.organizationId }, new Date(Date.now() - 60_000)),
      );
      expect(days).toEqual([]);
    });

    it("B4: deleting the workspace keeps its usage, unlinked, and the user's quota stays used", async () => {
      const c = await createUser("ws-deleter");
      const id = await readAndExtract(c);
      expect(await usedToday(c)).toBe(1);
      await db((d) => d.delete(organization).where(eq(organization.id, c.organizationId)));
      expect(await usedToday(c)).toBe(1);
      const [call] = await db((d) => d.select().from(ocrCalls).where(eq(ocrCalls.receiptId, id)));
      expect(call).toMatchObject({ organizationId: null, userId: c.userId, status: "ok" });
    });

    it("B4: a parallel burst can't get past the daily limit", async () => {
      const c = await createUser("burst");
      const tight = { perMinute: 100, perDay: 5 };
      const exits = await Promise.all(
        Array.from({ length: 8 }, () =>
          runExit(ingestUpload({ scope: c, fileName: "b.jpg", body: JPEG, limits: tight })),
        ),
      );
      expect(exits.filter(Exit.isSuccess)).toHaveLength(5);
      for (const exit of exits.filter(Exit.isFailure)) {
        expect(JSON.stringify(exit.cause)).toContain("QuotaExceeded");
      }
      // The refused ones stored nothing that stays.
      const rows = await db((d) =>
        d.select({ id: receipts.id }).from(receipts).where(eq(receipts.userId, c.userId)),
      );
      expect(rows).toHaveLength(5);
    });

    it("rolls usage up by day, model and workspace", async () => {
      const c = await createUser("rollup");
      await readAndExtract(c);
      await readAndExtract(c, FAILING_JPEG);
      const since = new Date(Date.now() - 60_000);
      const scope = { organizationId: c.organizationId };

      const days = await run(usageByDay(scope, since));
      expect(days).toEqual([
        {
          day: new Date().toISOString().slice(0, 10),
          receipts: 1,
          // One read, and a failing one tried four times.
          calls: 5,
          failedCalls: 4,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costMicroUsd: 0,
          unpricedCalls: 4,
        },
      ]);
      const [model] = await run(usageByModel(scope, since));
      expect(model).toMatchObject({ model: "fixture", calls: 5, failedCalls: 4, fallbackCalls: 0 });
      expect(model?.p50Ms).toEqual(expect.any(Number));

      const workspaces = await run(usageByWorkspace(since, 500));
      expect(workspaces.find((w) => w.organizationId === c.organizationId)).toMatchObject({
        calls: 5,
        receipts: 1,
      });
      // Another workspace sees none of it.
      expect(await run(usageByDay({ organizationId: b.organizationId }, since))).toEqual([]);
      const all = await run(usageByDay("all", since));
      expect(all[0]!.calls).toBeGreaterThanOrEqual(5);
    });
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
        use((db) => db.execute(sql`delete from rate_limit where id = ${key}`).then((r) => r.rows)),
      ),
    );
  });

  it("clearRateLimit resets a counter, and hitRateLimit never admits more than max concurrently", async () => {
    const key = `${tag}:clear`;
    const burst = await Promise.all(
      Array.from({ length: 15 }, () => run(hitRateLimit(key, 60_000, 10))),
    );
    expect(burst.filter((hit) => hit.allowed)).toHaveLength(10);
    await run(clearRateLimit(key));
    expect((await run(hitRateLimit(key, 60_000, 10))).allowed).toBe(true);
    await run(clearRateLimit(key));
  });
});
