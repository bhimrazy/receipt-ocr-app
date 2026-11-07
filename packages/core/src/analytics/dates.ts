/** Calendar-date arithmetic on `YYYY-MM-DD` strings. No time zones here: callers pick the day. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);

/** A real calendar date in `YYYY-MM-DD` form, or null. */
export function parseIsoDate(value: string | undefined | null): string | null {
  const match = value ? ISO_DATE.exec(value) : null;
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? value!
    : null;
}

export function addDays(iso: string, days: number) {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

export function daysInMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The same day `months` later or earlier, clamped to the month's length (31 Mar - 1 month = 28 Feb). */
export function shiftMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const target = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01`;
  return `${target.slice(0, 8)}${pad(Math.min(d, daysInMonth(target)))}`;
}

export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/** Inclusive day count. */
export const daySpan = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1;

/** 1 (Monday) to 7 (Sunday), as Postgres `isodow`. */
export const isoWeekday = (iso: string) => ((toDate(iso).getUTCDay() + 6) % 7) + 1;
