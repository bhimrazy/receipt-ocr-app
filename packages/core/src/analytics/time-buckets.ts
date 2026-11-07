/**
 * Time buckets shared by dashboards: SQL returns sparse (bucket, value) rows
 * from `bucketSql`, and `fillBuckets` zero-fills them over `bucketsBetween`.
 * Bucket keys are `YYYY-MM-DD` (the bucket's first day); weeks start on
 * Monday, as Postgres `date_trunc('week', …)` does. Hour buckets are keyed
 * `YYYY-MM-DDTHH`, the local hour in `tz`.
 */
import { sql, type SQL } from "@receipt-ocr/db";
import { addDays, monthStart, isoWeekday, shiftMonths } from "./dates";

export type BucketUnit = "hour" | "day" | "week" | "month";

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

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local hour an instant falls in, in `tz`, as `YYYY-MM-DDTHH`. */
export function localHour(at: Date, tz = "UTC") {
  let formatter = hourFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    hourFormatters.set(tz, formatter);
  }
  const part = (type: string) => formatter.formatToParts(at).find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}`;
}

const HOUR_MS = 3_600_000;

/** Hour keys from the hour holding `from` to the one holding `to`, stepping instants (DST-safe). */
function hoursBetween(from: Date, to: Date, tz: string) {
  const keys: string[] = [];
  const last = localHour(to, tz);
  for (let t = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS; t <= to.getTime(); t += HOUR_MS) {
    const key = localHour(new Date(t), tz);
    if (key !== keys.at(-1)) keys.push(key);
  }
  if (keys.length > 0 && keys.at(-1) !== last) keys.push(last);
  return keys;
}

/** The key of the bucket holding a calendar day. */
export function bucketOf(day: string, unit: Exclude<BucketUnit, "hour">) {
  if (unit === "day") return day;
  return unit === "week" ? addDays(day, 1 - isoWeekday(day)) : monthStart(day);
}

const next = (key: string, unit: Exclude<BucketUnit, "hour">) =>
  unit === "day" ? addDays(key, 1) : unit === "week" ? addDays(key, 7) : shiftMonths(key, 1);

/**
 * Every bucket key from the one holding `from` to the one holding `to`,
 * inclusive. Instants are read as calendar days in `tz`; date strings as is.
 * The "hour" unit needs instants.
 */
export function bucketsBetween(
  from: Date | string,
  to: Date | string,
  unit: BucketUnit,
  tz = "UTC",
): string[] {
  if (unit === "hour") {
    if (typeof from === "string" || typeof to === "string") {
      throw new TypeError("Hour buckets need instants, not dates");
    }
    return hoursBetween(from, to, tz);
  }
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
 * The bucket key in SQL, as `YYYY-MM-DD` text (`YYYY-MM-DDTHH` for hours). With `tz`, `expr` is a
 * timestamptz read in that zone; without, a date or a timestamp without zone.
 */
export function bucketSql(expr: SQL, unit: BucketUnit, tz?: string): SQL {
  const local = tz ? sql`(${expr} at time zone ${tz})` : sql`(${expr})::timestamp`;
  if (unit === "hour") return sql`to_char(date_trunc('hour', ${local}), 'YYYY-MM-DD"T"HH24')`;
  return sql`date_trunc(${unit}, ${local})::date::text`;
}
