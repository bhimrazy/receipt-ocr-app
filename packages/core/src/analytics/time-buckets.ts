/**
 * Time buckets shared by dashboards: SQL returns sparse (bucket, value) rows
 * from `bucketSql`, and `fillBuckets` zero-fills them over `bucketsBetween`.
 * Bucket keys are `YYYY-MM-DD` (the bucket's first day); weeks start on
 * Monday, as Postgres `date_trunc('week', …)` does.
 */
import { sql, type SQL } from "@receipt-ocr/db";
import { addDays, monthStart, isoWeekday, shiftMonths } from "./dates";

export type BucketUnit = "day" | "week" | "month";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** True when Intl (and so Postgres, for IANA names) knows the zone. */
export function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day an instant falls on in `tz`. */
export function localDate(at: Date, tz = "UTC") {
  let formatter = dayFormatters.get(tz);
  if (!formatter) {
    // en-CA formats as YYYY-MM-DD.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(tz, formatter);
  }
  return formatter.format(at);
}

/** Today's calendar day in `tz`. */
export const todayIn = (tz = "UTC", now = new Date()) => localDate(now, tz);

/** The key of the bucket holding a calendar day. */
export function bucketOf(day: string, unit: BucketUnit) {
  if (unit === "day") return day;
  return unit === "week" ? addDays(day, 1 - isoWeekday(day)) : monthStart(day);
}

const next = (key: string, unit: BucketUnit) =>
  unit === "day" ? addDays(key, 1) : unit === "week" ? addDays(key, 7) : shiftMonths(key, 1);

/**
 * Every bucket key from the one holding `from` to the one holding `to`,
 * inclusive. Instants are read as calendar days in `tz`; date strings as is.
 */
export function bucketsBetween(
  from: Date | string,
  to: Date | string,
  unit: BucketUnit,
  tz = "UTC",
): string[] {
  const day = (v: Date | string) => (typeof v === "string" ? v : localDate(v, tz));
  const last = bucketOf(day(to), unit);
  const keys: string[] = [];
  for (let key = bucketOf(day(from), unit); key <= last; key = next(key, unit)) keys.push(key);
  return keys;
}

/** One entry per bucket, in order: the row's value, or `empty` where SQL returned none. */
export function fillBuckets<V>(
  buckets: readonly string[],
  rows: Iterable<{ bucket: string; value: V }>,
  empty: V,
): { bucket: string; value: V }[] {
  const byKey = new Map<string, V>();
  for (const row of rows) byKey.set(row.bucket, row.value);
  return buckets.map((bucket) => ({ bucket, value: byKey.get(bucket) ?? empty }));
}

/**
 * The bucket key in SQL, as `YYYY-MM-DD` text. With `tz`, `expr` is a
 * timestamptz read in that zone; without, a date or a timestamp without zone.
 */
export function bucketSql(expr: SQL, unit: BucketUnit, tz?: string): SQL {
  const local = tz ? sql`(${expr} at time zone ${tz})` : sql`(${expr})::timestamp`;
  return sql`date_trunc(${unit}, ${local})::date::text`;
}
