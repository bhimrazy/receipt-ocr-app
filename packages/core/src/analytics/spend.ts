import { sql, type SQL } from "@receipt-ocr/db";
import { Effect } from "effect";
import { InvalidInput, NotConfigured, type DbError } from "../errors";
import { Db } from "../services";
import { addDays, daysInMonth, monthStart, shiftMonths } from "./dates";
import type { SpendRange } from "./range";
import { bucketSql, bucketsBetween, fillBuckets, isTimeZone } from "./time-buckets";

/**
 * Spending totals for the Home dashboard. Totals stay in each receipt's own
 * currency: nothing here adds two currencies together.
 */

type Amount = { total: number; count: number };

export type SpendBucket = Amount & { start: string; end: string };
export type CategorySpend = Amount & { category: string | null };
export type MerchantSpend = Amount & { key: string; name: string };
/** What the top entries leave out, so the breakdown still adds up to the range total. */
export type RestSpend = Amount & { groups: number | null };
export type WeekdaySpend = Amount & { isoDay: number };
export type MonthSpend = Amount & { month: string };
export type LargestReceipt = {
  id: string;
  merchant: string | null;
  date: string;
  usesUploadDate: boolean;
  total: number;
};

/** Month to date against the same number of days of last month. */
export type ThisMonth = {
  month: string;
  lastMonth: string;
  /** Day of the month today is. */
  day: number;
  daysInMonth: number;
  toDate: number;
  count: number;
  lastMonthToDate: number;
  lastMonthTotal: number;
  /** Straight-line pace to the end of the month; null before PROJECT_FROM_DAY. */
  projected: number | null;
  /** Cumulative spend at the end of each day, this month up to today. */
  cumulative: number[];
  /** Cumulative spend for every day of last month. */
  lastMonthCumulative: number[];
};

export type CurrencySpend = Amount & {
  currency: string;
  tax: number;
  /** Receipts in the range whose date couldn't be read, placed by upload date instead. */
  usesUploadDate: number;
  previous: Amount;
  /** Zero-filled, one bucket per day, week or month of the range. */
  series: SpendBucket[];
  /** The previous period the same way; its bucket count can differ by one. */
  previousSeries: SpendBucket[];
  categories: { top: CategorySpend[]; rest: RestSpend | null };
  /** Merchants grouped by trimmed, case-folded name. */
  merchants: { top: MerchantSpend[]; rest: RestSpend | null };
  /** Monday (1) to Sunday (7), zero-filled. */
  weekdays: WeekdaySpend[];
  /** The last 12 calendar months, oldest first, this month last. */
  months: MonthSpend[];
  /** Average of the complete months since the first one with spend, or null. */
  monthlyAverage: number | null;
  thisMonth: ThisMonth;
  largest: LargestReceipt[];
  /** Receipts in the 12 calendar months; orders currencies with nothing in the range. */
  yearCount: number;
};

export type SpendDashboard = {
  range: SpendRange;
  today: string;
  timeZone: string;
  /** Most-used currency first (by receipts in the range, then in the last 12 months). */
  currencies: CurrencySpend[];
};

/**
 * Converts amounts between currencies. Not implemented yet: FX conversion is
 * planned separately, and until it lands every total stays per currency.
 */
export interface CurrencyConverter {
  /** Multiplier from `from` to `to` on the day `on` (YYYY-MM-DD). */
  readonly rate: (from: string, to: string, on: string) => Effect.Effect<number, NotConfigured>;
}

export type SpendQuery = {
  range: SpendRange;
  /** Today in `timeZone`, YYYY-MM-DD. */
  today: string;
  /** Where upload times become days, for receipts without a readable date. Default UTC. */
  timeZone?: string;
  /** "All, in <currency>". Fails with NotConfigured until conversion ships. */
  convertTo?: { currency: string; converter: CurrencyConverter };
};

export type AnalyticsScope = { organizationId: string };

export const TOP_ENTRIES = 10;
export const LARGEST_RECEIPTS = 5;
/** Earlier in the month a straight-line projection says more about one receipt than the month. */
export const PROJECT_FROM_DAY = 7;

type Windows = {
  range: SpendRange;
  today: string;
  tz: string;
  yearFrom: string;
  lastMonthFrom: string;
  windowFrom: string;
  windowTo: string;
};

function windows(range: SpendRange, today: string, tz: string): Windows {
  const yearFrom = monthStart(shiftMonths(today, -11));
  const lastMonthFrom = monthStart(shiftMonths(today, -1));
  const windowFrom = [range.from, range.previous.from, yearFrom, lastMonthFrom].sort()[0]!;
  return {
    range,
    today,
    tz,
    yearFrom,
    lastMonthFrom,
    windowFrom,
    windowTo: range.to > today ? range.to : today,
  };
}

const d = (iso: string) => sql`${iso}::date`;

/**
 * Completed receipts of the workspace in the scanned window, each with its
 * effective date (the receipt date, or the upload day when unreadable) and
 * the windows it falls in.
 *
 * Every workspace member reads every receipt (see `ReceiptScope`), so only
 * the workspace narrows this. A receipt-group filter would go here, as one
 * more condition on `r` (an `exists` over the group membership table); the
 * dashboard doesn't take one yet, and History's `groups` links don't carry
 * the dashboard's range.
 *
 * `created_at >= windowFrom - 2 days` lets `receipts_org_created_at_idx` bound
 * the scan. It holds because `receipts_receipt_date_check` keeps every date
 * within a day of its UTC upload day; the second day is slack for time zones.
 * `materialized` computes each row's date once instead of in every filter.
 */
function tagged(scope: AnalyticsScope, w: Windows): SQL {
  const scanFrom = `${addDays(w.windowFrom, -2)}T00:00:00Z`;
  return sql`with base as materialized (
    select r.id,
      coalesce(r.currency, 'USD') as currency,
      r.total,
      coalesce(r.tax, 0) as tax,
      r.category,
      nullif(lower(btrim(r.merchant)), '') as merchant_key,
      nullif(btrim(r.merchant), '') as merchant,
      r.receipt_date as parsed,
      coalesce(r.receipt_date, (r.created_at at time zone ${w.tz})::date) as eff
    from receipts r
    where r.organization_id = ${scope.organizationId}
      and r.status = 'completed'
      and r.total is not null
      and r.created_at >= ${scanFrom}::timestamptz
  ), tagged as (
    select *,
      eff between ${d(w.range.from)} and ${d(w.range.to)} as in_range,
      eff between ${d(w.range.previous.from)} and ${d(w.range.previous.to)} as in_prev,
      eff between ${d(w.yearFrom)} and ${d(w.today)} as in_year,
      eff between ${d(w.lastMonthFrom)} and ${d(w.today)} as in_months
    from base
    where eff between ${d(w.windowFrom)} and ${d(w.windowTo)}
  )`;
}

/** `grouping(bucket, category, merchant_key, month, day, dow)` of each grouping set. */
const SET = {
  total: 63,
  bucket: 31,
  category: 47,
  merchant: 55,
  month: 59,
  day: 61,
  weekday: 62,
} as const;

type AggregateRow = {
  g: number;
  currency: string;
  bucket: string | null;
  category: string | null;
  merchant_key: string | null;
  month: string | null;
  day: string | null;
  dow: number | null;
  merchant_name: string | null;
  range_total: string;
  range_count: number;
  range_tax: string;
  range_fallback: number;
  prev_total: string;
  prev_count: number;
  year_total: string;
  year_count: number;
  months_total: string;
  months_count: number;
};

type LargestRow = {
  id: string;
  currency: string;
  merchant: string | null;
  date: string;
  fallback: boolean;
  total: string;
};

/**
 * One statement, one pass over the window. `agg` groups it seven ways per
 * currency: totals, range buckets (the range's and the previous period's,
 * which share a unit), categories, merchants, months, days and weekdays; each
 * set keeps only the groups its own window counts, merchants the top 10.
 * `top` is the largest receipts in the range. Both come back as JSON rows.
 */
function dashboardSql(scope: AnalyticsScope, w: Windows): SQL {
  const sum = (filter: string) => sql.raw(`coalesce(sum(total) filter (where ${filter}), 0)::text`);
  return sql`${tagged(scope, w)}, agg as (
    select * from (
      select grouping(bucket, category, merchant_key, month, day, dow)::int as g,
        currency, bucket, category, merchant_key, month, day::text, dow,
        mode() within group (order by merchant) filter (where in_range) as merchant_name,
        ${sum("in_range")} as range_total,
        (count(*) filter (where in_range))::int as range_count,
        coalesce(sum(tax) filter (where in_range), 0)::text as range_tax,
        (count(*) filter (where in_range and parsed is null))::int as range_fallback,
        ${sum("in_prev")} as prev_total,
        (count(*) filter (where in_prev))::int as prev_count,
        ${sum("in_year")} as year_total,
        (count(*) filter (where in_year))::int as year_count,
        ${sum("in_months")} as months_total,
        (count(*) filter (where in_months))::int as months_count,
        row_number() over (
          partition by grouping(bucket, category, merchant_key, month, day, dow), currency
          order by merchant_key is null, sum(total) filter (where in_range) desc nulls last, merchant_key
        ) as rank
      from (
        select *,
          ${bucketSql(sql`eff`, w.range.unit)} as bucket,
          ${bucketSql(sql`eff`, "month")} as month,
          eff as day,
          extract(isodow from eff)::int as dow
        from tagged
      ) t
      group by grouping sets (
        (currency), (currency, bucket), (currency, category), (currency, merchant_key),
        (currency, month), (currency, day), (currency, dow)
      )
    ) s
    where case g
      when ${SET.total} then true
      when ${SET.bucket} then range_count > 0 or prev_count > 0
      when ${SET.month} then year_count > 0
      when ${SET.day} then months_count > 0
      when ${SET.merchant} then range_count > 0 and merchant_key is not null and rank <= ${TOP_ENTRIES}
      else range_count > 0
    end
  ), top as (
    select id, currency, merchant, eff::text as date, parsed is null as fallback, total::text
    from (
      select *, row_number() over (partition by currency order by total desc, id) as rn
      from tagged where in_range
    ) t
    where rn <= ${LARGEST_RECEIPTS}
  )
  select 'agg' as kind, to_jsonb(agg) as row from agg
  union all
  select 'top', to_jsonb(top) from top`;
}

const num = (value: string | null | undefined) => Number(value ?? 0);

const ZERO_DECIMALS = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_DECIMALS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/**
 * ISO 4217 minor-unit digits (JPY 0, USD 2, KWD 3). A fixed table, not Intl:
 * Node and Bun carry different CLDR data (IDR, HUF, PKR), and the server's
 * rounding must not depend on the runtime. The web app keeps a copy for
 * display; a test keeps the two equal.
 */
export function minorUnits(currency: string) {
  const code = currency.toUpperCase();
  return ZERO_DECIMALS.has(code) ? 0 : THREE_DECIMALS.has(code) ? 3 : 2;
}

/** Rounds to the currency's minor unit, so sums don't drift or lose a third decimal. */
const rounder = (currency: string) => {
  const factor = 10 ** minorUnits(currency);
  return (value: number) => Math.round(value * factor) / factor;
};

function cumulative(
  daily: Map<string, number>,
  first: string,
  days: number,
  cents: (value: number) => number,
) {
  const out: number[] = [];
  let running = 0;
  for (let i = 0; i < days; i++) {
    running += daily.get(addDays(first, i)) ?? 0;
    out.push(cents(running));
  }
  return out;
}

/** Remainder after the top entries; null when nothing is left out. */
function rest(
  all: Amount,
  top: readonly Amount[],
  groups: number | null,
  cents: (value: number) => number,
): RestSpend | null {
  const count = all.count - top.reduce((n, e) => n + e.count, 0);
  if (count <= 0) return null;
  return { total: cents(all.total - top.reduce((n, e) => n + e.total, 0)), count, groups };
}

/** Zero-filled series over [from, to], bucket bounds clipped to it. */
function series(
  from: string,
  to: string,
  unit: SpendRange["unit"],
  rows: Map<string, Amount>,
): SpendBucket[] {
  const keys = bucketsBetween(from, to, unit);
  return fillBuckets(
    keys,
    [...rows].map(([bucket, value]) => ({ bucket, value })),
    { total: 0, count: 0 },
  ).map(({ bucket, value }, i) => {
    const nextKey = keys[i + 1];
    const end = nextKey ? addDays(nextKey, -1) : to;
    return { start: bucket < from ? from : bucket, end: end < to ? end : to, ...value };
  });
}

/** Turns grouped rows into per-currency dashboards, zero-filling every series. */
export function assembleDashboard(
  rows: readonly AggregateRow[],
  largest: readonly LargestRow[],
  range: SpendRange,
  today: string,
  timeZone = "UTC",
): SpendDashboard {
  const w = windows(range, today, timeZone);
  const byCurrency = new Map<string, AggregateRow[]>();
  for (const row of rows) {
    const list = byCurrency.get(row.currency) ?? [];
    list.push(row);
    byCurrency.set(row.currency, list);
  }

  const monthKeys = bucketsBetween(w.yearFrom, today, "month");
  const thisMonthFrom = monthStart(today);
  const day = Number(today.slice(8, 10));
  const monthDays = daysInMonth(today);
  const lastMonthDays = daysInMonth(w.lastMonthFrom);

  const currencies: CurrencySpend[] = [];
  for (const [currency, list] of byCurrency) {
    const cents = rounder(currency);
    const of = (g: number) => list.filter((row) => row.g === g);
    const totalRow = of(SET.total)[0];
    if (!totalRow) continue;
    const all = { total: num(totalRow.range_total), count: totalRow.range_count };

    const bucketRows = of(SET.bucket);
    const rangeBuckets = new Map(
      bucketRows.map((r) => [r.bucket!, { total: num(r.range_total), count: r.range_count }]),
    );
    const prevBuckets = new Map(
      bucketRows.map((r) => [r.bucket!, { total: num(r.prev_total), count: r.prev_count }]),
    );
    const months = new Map(
      of(SET.month).map((r) => [r.month!, { total: num(r.year_total), count: r.year_count }]),
    );
    const days = new Map(of(SET.day).map((r) => [r.day!, num(r.months_total)]));
    const weekdays = new Map(of(SET.weekday).map((r) => [r.dow!, r]));

    const monthSeries = fillBuckets(
      monthKeys,
      [...months].map(([bucket, value]) => ({ bucket, value })),
      { total: 0, count: 0 },
    ).map(({ bucket, value }) => ({ month: bucket, ...value }));
    // Complete months only, from the first with spend, so a new workspace
    // isn't averaged against months before it existed.
    const firstSpend = monthSeries.findIndex((m) => m.count > 0);
    const complete = firstSpend === -1 ? [] : monthSeries.slice(firstSpend, -1);
    const monthlyAverage = complete.length
      ? cents(complete.reduce((acc, m) => acc + m.total, 0) / complete.length)
      : null;

    const thisCumulative = cumulative(days, thisMonthFrom, day, cents);
    const lastCumulative = cumulative(days, w.lastMonthFrom, lastMonthDays, cents);
    const toDate = thisCumulative.at(-1) ?? 0;

    const categories = of(SET.category)
      .map((r) => ({ category: r.category, total: num(r.range_total), count: r.range_count }))
      .sort((a, b) => b.total - a.total || b.count - a.count);
    const topCategories = categories.slice(0, TOP_ENTRIES);
    const merchants = of(SET.merchant)
      .map((r) => ({
        key: r.merchant_key!,
        name: r.merchant_name ?? r.merchant_key!,
        total: num(r.range_total),
        count: r.range_count,
      }))
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

    currencies.push({
      currency,
      ...all,
      tax: num(totalRow.range_tax),
      usesUploadDate: totalRow.range_fallback,
      previous: { total: num(totalRow.prev_total), count: totalRow.prev_count },
      series: series(range.from, range.to, range.unit, rangeBuckets),
      previousSeries: series(range.previous.from, range.previous.to, range.unit, prevBuckets),
      categories: {
        top: topCategories,
        rest: rest(all, topCategories, categories.length - topCategories.length, cents),
      },
      merchants: { top: merchants, rest: rest(all, merchants, null, cents) },
      weekdays: [1, 2, 3, 4, 5, 6, 7].map((isoDay) => ({
        isoDay,
        total: num(weekdays.get(isoDay)?.range_total),
        count: weekdays.get(isoDay)?.range_count ?? 0,
      })),
      months: monthSeries,
      monthlyAverage,
      thisMonth: {
        month: thisMonthFrom,
        lastMonth: w.lastMonthFrom,
        day,
        daysInMonth: monthDays,
        toDate,
        count: monthSeries.at(-1)?.count ?? 0,
        lastMonthToDate: lastCumulative[Math.min(day, lastMonthDays) - 1] ?? 0,
        lastMonthTotal: lastCumulative.at(-1) ?? 0,
        projected: day >= PROJECT_FROM_DAY ? cents((toDate / day) * monthDays) : null,
        cumulative: thisCumulative,
        lastMonthCumulative: lastCumulative,
      },
      largest: largest
        .filter((r) => r.currency === currency)
        .map((r) => ({
          id: r.id,
          merchant: r.merchant,
          date: r.date,
          usesUploadDate: r.fallback,
          total: num(r.total),
        })),
      yearCount: totalRow.year_count,
    });
  }

  currencies.sort(
    (a, b) =>
      b.count - a.count || b.yearCount - a.yearCount || a.currency.localeCompare(b.currency),
  );
  return { range, today, timeZone, currencies };
}

/**
 * The dashboard for one workspace: one statement, its scan bounded by
 * `receipts_org_created_at_idx` (organization_id, created_at).
 */
export const spendDashboard = (
  scope: AnalyticsScope,
  query: SpendQuery,
): Effect.Effect<SpendDashboard, DbError | NotConfigured | InvalidInput, Db> => {
  const tz = query.timeZone ?? "UTC";
  if (query.convertTo) {
    return Effect.fail(new NotConfigured({ message: "Currency conversion isn't available yet" }));
  }
  if (!isTimeZone(tz)) return Effect.fail(new InvalidInput({ message: `Unknown time zone ${tz}` }));
  const w = windows(query.range, query.today, tz);
  return Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const rows = await db.execute<
        { kind: "agg"; row: AggregateRow } | { kind: "top"; row: LargestRow }
      >(dashboardSql(scope, w));
      const agg: AggregateRow[] = [];
      const top: LargestRow[] = [];
      for (const r of rows) {
        if (r.kind === "agg") agg.push(r.row);
        else top.push(r.row);
      }
      return assembleDashboard(agg, top, query.range, query.today, tz);
    }),
  );
};

/** The dashboard statement, for EXPLAIN in tests. */
export const spendDashboardSql = (scope: AnalyticsScope, query: SpendQuery) =>
  dashboardSql(scope, windows(query.range, query.today, query.timeZone ?? "UTC"));
