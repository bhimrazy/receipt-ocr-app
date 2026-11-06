/**
 * The dashboard range as it lives in the URL: `?range=3m`, or
 * `?from=-30d&to=today`, `?compare=0`, `?currency=EUR`. Parsing never throws;
 * anything malformed falls back to the last 30 days.
 */
import { z } from "zod";
import { addDays, daySpan, parseIsoDate, shiftMonths } from "./dates";
import type { BucketUnit } from "./time-buckets";

export const RANGE_PRESETS = ["30d", "3m", "12m", "ytd", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Custom ranges longer than this are shortened from the start; it bounds the scan. */
export const MAX_RANGE_DAYS = 3 * 366;

export type SpendRange = {
  preset: RangePreset;
  /** Inclusive calendar days. */
  from: string;
  to: string;
  unit: BucketUnit;
  /** Show the previous period and the change against it. */
  compare: boolean;
  previous: { from: string; to: string; kind: "previous-period" | "last-year" };
};

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const param = <T extends z.ZodType>(schema: T) =>
  z.preprocess(first, schema.optional()).catch(undefined);

/** Search params of the Home dashboard. Unknown or bad values become undefined. */
export const spendSearchSchema = z.object({
  range: param(z.enum(RANGE_PRESETS)),
  from: param(z.string().max(32)),
  to: param(z.string().max(32)),
  compare: param(z.enum(["0", "1"])),
  currency: param(
    z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((code) => code.toUpperCase()),
  ),
});

export type SpendSearch = z.output<typeof spendSearchSchema>;

export const parseSpendSearch = (params: Record<string, string | string[] | undefined>) =>
  spendSearchSchema.parse(params);

const RELATIVE = /^-(\d{1,4})(d|w|mo|y)$/;

/** `today`, `-30d`, `-2w`, `-3mo`, `-1y` or `YYYY-MM-DD`, as a date; null when unreadable. */
export function resolveDateValue(value: string | undefined, today: string): string | null {
  if (!value) return null;
  if (value === "today") return today;
  const relative = RELATIVE.exec(value);
  if (relative) {
    const n = Number(relative[1]);
    switch (relative[2]) {
      case "d":
        return addDays(today, -n);
      case "w":
        return addDays(today, -7 * n);
      case "mo":
        return shiftMonths(today, -n);
      default:
        return shiftMonths(today, -12 * n);
    }
  }
  return parseIsoDate(value);
}

/** Daily up to a month, weekly up to about a quarter, monthly beyond. */
export function unitFor(from: string, to: string): BucketUnit {
  const days = daySpan(from, to);
  if (days <= 31) return "day";
  return days <= 92 ? "week" : "month";
}

/** The same month and day a year earlier; 29 February becomes the 28th. */
const lastYear = (iso: string) => shiftMonths(iso, -12);

export function resolveRange(search: SpendSearch, today: string): SpendRange {
  const preset: RangePreset = search.range ?? (search.from || search.to ? "custom" : "30d");
  const compare = search.compare !== "0";
  let from: string;
  let to = today;
  let previous: SpendRange["previous"] | undefined;

  switch (preset) {
    case "3m":
      from = addDays(today, -89);
      break;
    case "12m":
      // Twelve calendar months including this one, the same months as the monthly chart.
      from = `${shiftMonths(today, -11).slice(0, 7)}-01`;
      previous = {
        from: `${shiftMonths(today, -23).slice(0, 7)}-01`,
        to: addDays(from, -1),
        kind: "previous-period",
      };
      break;
    case "ytd":
      from = `${today.slice(0, 4)}-01-01`;
      previous = { from: lastYear(from), to: lastYear(today), kind: "last-year" };
      break;
    case "custom": {
      const a = resolveDateValue(search.from, today);
      const b = resolveDateValue(search.to, today) ?? today;
      if (!a) return resolveRange({ compare: search.compare }, today);
      [from, to] = a <= b ? [a, b] : [b, a];
      if (daySpan(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
      break;
    }
    default:
      from = addDays(today, -29);
  }

  if (!previous) {
    const prevTo = addDays(from, -1);
    previous = {
      from: addDays(prevTo, -(daySpan(from, to) - 1)),
      to: prevTo,
      kind: "previous-period",
    };
  }
  return { preset, from, to, unit: unitFor(from, to), compare, previous };
}
