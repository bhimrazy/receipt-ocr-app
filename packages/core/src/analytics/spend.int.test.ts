/**
 * Spending aggregates against real Postgres. Skipped unless INTEGRATION=1;
 * run with `bun run --filter @receipt-ocr/core test:int` after
 * `bun run db:migrate`, with DATABASE_URL set.
 */
import { organization, receipts, sql, user, type NewReceipt } from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db } from "../services";
import { ensurePersonalWorkspace } from "../workspace";
import { parseSpendSearch, resolveRange } from "./range";
import { spendDashboardSql, spendDashboard, type SpendQuery } from "./spend";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(Db.Live);
const run = <A, E>(effect: Effect.Effect<A, E, Db>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `spend-${Date.now()}`;
const TODAY = "2026-11-06";

async function workspace(name: string) {
  const id = `${tag}-${name}`;
  await db((d) => d.insert(user).values({ id, name, email: `${id}@example.com` }));
  const organizationId = await run(
    ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }),
  );
  if (!organizationId) throw new Error("no workspace");
  return { organizationId, userId: id };
}

type Seed = Partial<NewReceipt> & { date: string | null; total: string | null; uploaded?: string };

/** A completed receipt uploaded the day after its date unless `uploaded` says otherwise. */
function row(ws: { organizationId: string; userId: string }, seed: Seed): NewReceipt {
  const { date, uploaded, ...rest } = seed;
  const day = date ?? TODAY;
  return {
    organizationId: ws.organizationId,
    userId: ws.userId,
    status: "completed",
    currency: "USD",
    category: "Groceries",
    merchant: "Shop",
    receiptDate: date,
    createdAt: new Date(uploaded ?? `${day}T12:00:00Z`),
    ...rest,
  };
}

const insert = (rows: NewReceipt[]) => db((d) => d.insert(receipts).values(rows));

const query = (params: Record<string, string> = {}, extra: Partial<SpendQuery> = {}) => ({
  range: resolveRange(parseSpendSearch(params), TODAY),
  today: TODAY,
  ...extra,
});

describe.skipIf(!enabled)("spending aggregates against Postgres", () => {
  let main: Awaited<ReturnType<typeof workspace>>;
  let other: Awaited<ReturnType<typeof workspace>>;

  beforeAll(async () => {
    main = await workspace("main");
    other = await workspace("other");
    await insert([
      // In the last 30 days (2026-10-08 .. 2026-11-06), USD.
      row(main, { date: "2026-10-08", total: "10.00", tax: "1.00", merchant: " Tesco " }),
      row(main, { date: "2026-11-06", total: "20.00", tax: "2.00", merchant: "TESCO" }),
      row(main, { date: "2026-11-02", total: "30.50", merchant: "TESCO ", category: "Meals" }),
      row(main, { date: "2026-11-03", total: "5.25", merchant: "Cafe", category: null }),
      // The day before the range: previous period only.
      row(main, { date: "2026-10-07", total: "100.00", merchant: "Old" }),
      // No date (none read, or an unreal one dropped on write) falls back to the UTC upload day.
      row(main, { date: null, total: "1.00", uploaded: "2026-11-01T10:00:00Z" }),
      row(main, { date: null, total: "2.00", uploaded: "2026-11-01T10:00:00Z" }),
      row(main, { date: null, total: "3.00", uploaded: "2026-10-20T10:00:00Z" }),
      // Another currency, never added to USD.
      row(main, { date: "2026-11-01", total: "1500.00", currency: "JPY", merchant: "Lawson" }),
      // Left out: not completed, no total, another workspace.
      row(main, { date: "2026-11-01", total: "999.00", status: "failed" }),
      row(main, { date: "2026-11-01", total: "999.00", status: "processing" }),
      row(main, { date: "2026-11-01", total: null }),
      row(other, { date: "2026-11-01", total: "999.00" }),
      // Twelve-month window: June and last month.
      row(main, { date: "2026-06-15", total: "40.00", merchant: "June" }),
    ]);
  });

  afterAll(async () => {
    await db(async (d) => {
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  it("keeps each currency separate and puts the most-used first", async () => {
    const result = await run(spendDashboard(main, query()));
    expect(result.currencies.map((c) => c.currency)).toEqual(["USD", "JPY"]);
    const [usd, jpy] = result.currencies;
    // 10 + 20 + 30.50 + 5.25 + 1 + 2 + 3: the failed, processing, null-total and other-workspace rows are out.
    expect(usd).toMatchObject({ total: 71.75, count: 7, tax: 3 });
    expect(jpy).toMatchObject({ total: 1500, count: 1 });
  });

  it("places unreadable dates on their upload day and counts them", async () => {
    const usd = (await run(spendDashboard(main, query()))).currencies[0]!;
    expect(usd.usesUploadDate).toBe(3);
    const day = (iso: string) => usd.series.find((b) => b.start === iso)!;
    expect(day("2026-11-01")).toMatchObject({ total: 3, count: 2 });
    expect(day("2026-10-20")).toMatchObject({ total: 3, count: 1 });
  });

  it("reads upload times in the requested zone", async () => {
    await insert([row(other, { date: null, total: "7.00", uploaded: "2026-10-31T23:30:00Z" })]);
    const days = async (timeZone: string) => {
      const usd = (await run(spendDashboard(other, query({}, { timeZone })))).currencies[0]!;
      const total = (iso: string) => usd.series.find((b) => b.start === iso)!.total;
      // The other workspace already has 999.00 dated 1 November.
      return [total("2026-10-31"), total("2026-11-01")];
    };
    expect(await days("UTC")).toEqual([7, 999]);
    expect(await days("Asia/Kathmandu")).toEqual([0, 1006]);
  });

  it("includes both range edges and compares against the period before", async () => {
    const usd = (await run(spendDashboard(main, query()))).currencies[0]!;
    expect(usd.series).toHaveLength(30);
    expect(usd.series[0]).toMatchObject({ start: "2026-10-08", total: 10 });
    expect(usd.series.at(-1)).toMatchObject({ start: "2026-11-06", total: 20 });
    expect(usd.previous).toEqual({ total: 100, count: 1 });
    expect(usd.previousSeries.at(-1)).toMatchObject({ start: "2026-10-07", total: 100 });
  });

  it("buckets weekly from Monday for 3 months, zero-filled", async () => {
    const usd = (await run(spendDashboard(main, query({ range: "3m" })))).currencies[0]!;
    // 2026-08-09 (a Sunday) to 2026-11-06: the first bucket is clipped to the range.
    expect(usd.series[0]).toMatchObject({ start: "2026-08-09", end: "2026-08-09", total: 0 });
    expect(usd.series.at(-1)).toMatchObject({ start: "2026-11-02", end: "2026-11-06" });
    // 2 Nov (30.50), 3 Nov (5.25) and 6 Nov (20): the week of Monday 2 November.
    expect(usd.series.at(-1)!.total).toBe(55.75);
    expect(usd.series.filter((b) => b.total === 0).length).toBeGreaterThan(5);
  });

  it("groups merchants by trimmed, case-folded name with the common spelling", async () => {
    const usd = (await run(spendDashboard(main, query()))).currencies[0]!;
    expect(usd.merchants.top[0]).toEqual({ key: "tesco", name: "TESCO", total: 60.5, count: 3 });
    // "Shop" covers the three receipts with fallback dates; the breakdown adds up to the total.
    const named = usd.merchants.top.reduce((n, m) => n + m.total, 0);
    expect(named + (usd.merchants.rest?.total ?? 0)).toBeCloseTo(usd.total);
    expect(usd.categories.top.find((c) => c.category === null)).toMatchObject({ total: 5.25 });
  });

  it("builds this month's pace and the last 12 months", async () => {
    const usd = (await run(spendDashboard(main, query()))).currencies[0]!;
    // November so far: 3 (1 Nov) + 30.50 + 5.25 + 20.
    expect(usd.thisMonth).toMatchObject({ day: 6, toDate: 58.75, projected: null });
    expect(usd.thisMonth.cumulative).toHaveLength(6);
    // October to the 6th has nothing; October in all: 10 + 100 + 3.
    expect(usd.thisMonth.lastMonthToDate).toBe(0);
    expect(usd.thisMonth.lastMonthTotal).toBe(113);
    expect(usd.months).toHaveLength(12);
    expect(usd.months[0]!.month).toBe("2025-12-01");
    expect(usd.months.find((m) => m.month === "2026-06-01")!.total).toBe(40);
    // June to October (five complete months): (40 + 0 + 0 + 0 + 113) / 5.
    expect(usd.monthlyAverage).toBe(30.6);
    expect(usd.largest.map((r) => r.total)).toEqual([30.5, 20, 10, 5.25, 3]);
  });

  it("returns nothing for a workspace without completed receipts", async () => {
    const empty = await workspace("empty");
    expect((await run(spendDashboard(empty, query()))).currencies).toEqual([]);
  });

  it("reads a receipt without a currency as USD and keeps more than 10 merchants and categories in 'rest'", async () => {
    const ws = await workspace("many");
    await insert([
      row(ws, { date: "2026-11-01", total: "5.00", currency: null }),
      ...Array.from({ length: 12 }, (_, i) =>
        row(ws, {
          date: "2026-11-02",
          total: `${20 - i}.00`,
          merchant: `Shop ${i}`,
          category: `Category ${i}`,
        }),
      ),
    ]);
    const usd = (await run(spendDashboard(ws, query()))).currencies;
    expect(usd.map((c) => c.currency)).toEqual(["USD"]);
    const only = usd[0]!;
    expect(only.count).toBe(13);
    expect(only.merchants.top).toHaveLength(10);
    expect(only.merchants.rest).toMatchObject({ count: 3 });
    expect(only.categories.top).toHaveLength(10);
    expect(only.categories.rest).toMatchObject({ count: 3, groups: 3 });
  });

  it("refuses conversion until it exists", async () => {
    const exit = await runtime.runPromiseExit(
      spendDashboard(
        main,
        query({}, { convertTo: { currency: "USD", converter: { rate: () => Effect.succeed(1) } } }),
      ),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("NotConfigured");
  });

  it("stays on the workspace index at 10k receipts", async () => {
    const big = await workspace("big");
    // About 10k receipts over two years, a few currencies, some unreadable dates.
    await db((d) =>
      d
        .execute(
          sql`insert into receipts
          (organization_id, user_id, status, currency, category, merchant, receipt_date, total, tax, created_at)
        select ${big.organizationId}, ${big.userId}, 'completed',
          (array['USD','USD','USD','EUR','JPY'])[1 + i % 5],
          (array['Meals','Groceries','Travel','Fuel','Office'])[1 + i % 5],
          'Merchant ' || (i % 300),
          case when i % 50 = 0 then null else ${TODAY}::date - (i % 730) end,
          (i % 97) + 0.99, (i % 7) + 0.10,
          (${TODAY}::date - (i % 730))::timestamptz + interval '13 hours'
        from generate_series(1, 10000) as i`,
        )
        .then((r) => r.rows),
    );
    // Other workspaces share the table, as in production.
    const noise = await workspace("noise");
    await db((d) =>
      d
        .execute(
          sql`insert into receipts (organization_id, status, currency, receipt_date, total, created_at)
        select ${noise.organizationId}, 'completed', 'USD', ${TODAY}::date - (i % 730),
          10, (${TODAY}::date - (i % 730))::timestamptz
        from generate_series(1, 40000) as i`,
        )
        .then((r) => r.rows),
    );
    await db((d) => d.execute(sql`analyze receipts`).then((r) => r.rows));

    const plan = await db((d) =>
      d
        .execute<{ "QUERY PLAN": string }>(
          sql`explain (analyze, buffers) ${spendDashboardSql(big, query({ range: "12m" }))}`,
        )
        .then((r) => r.rows),
    );
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    console.log(`spend dashboard plan, 10k receipts, 12 months:\n${text}`);
    // Either workspace index: when the window covers most of the workspace the
    // planner may take (organization_id, receipt_date) for its prefix.
    expect(text).toMatch(/receipts_org_(created_at|receipt_date)_idx/);
    expect(text).not.toMatch(/Seq Scan on receipts/);

    const started = performance.now();
    const result = await run(spendDashboard(big, query({ range: "12m" })));
    console.log(
      `spendDashboard 12m on 10k receipts: ${Math.round(performance.now() - started)} ms`,
    );
    expect(result.currencies.map((c) => c.currency)).toEqual(["USD", "EUR", "JPY"]);
  });
});
