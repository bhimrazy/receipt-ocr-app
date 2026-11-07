/**
 * Formatting for dashboard figures, shared by server and client components.
 * Fixed locale and time zone so both render identical strings.
 */

/** One prop for every figure a chart shows. */
export type ValueFormat = { kind: "money"; currency: string } | { kind: "count" } | { kind: "ms" };

const LOCALE = "en-US";

/**
 * ISO 4217 gives these two decimals, but prices are quoted in whole units;
 * amounts with fractions still show them.
 */
const WHOLE_UNITS = new Set(["IDR", "NPR"]);

const formatters = new Map<string, Intl.NumberFormat | null>();

function moneyFormatter(currency: string, compact: boolean, whole: boolean) {
  const key = `${currency}:${compact}:${whole}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  let formatter: Intl.NumberFormat | null;
  try {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : WHOLE_UNITS.has(currency)
          ? // Explicit either way, so the server and the browser never pick their own default.
            { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }
          : {}),
    });
  } catch {
    // Not a currency Intl knows (a manual edit); show the code instead.
    formatter = null;
  }
  formatters.set(key, formatter);
  return formatter;
}

/** An amount in its own currency: JPY with no decimals, KWD with three, IDR whole when whole. */
export function formatMoney(
  value: number,
  currency: string,
  options: { compact?: boolean; axis?: boolean } = {},
) {
  const code = currency.toUpperCase();
  // Axis ticks are always short ("£1.5K", "£500"); elsewhere only big numbers are.
  const compact = Boolean(options.axis) || (Boolean(options.compact) && Math.abs(value) >= 10_000);
  const whole = WHOLE_UNITS.has(code) && Number.isInteger(value);
  const formatter = moneyFormatter(code, compact, whole);
  if (formatter) return formatter.format(value);
  return `${code} ${value.toFixed(2)}`;
}

const countFormat = new Intl.NumberFormat(LOCALE);
const compactCount = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatValue(
  value: number,
  format: ValueFormat,
  options: { compact?: boolean; axis?: boolean } = {},
) {
  switch (format.kind) {
    case "money":
      return formatMoney(value, format.currency, options);
    case "count":
      return (
        options.axis || (options.compact && value >= 10_000) ? compactCount : countFormat
      ).format(value);
    case "ms":
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
  }
}

/** Change from `previous` to `current` as a fraction, or null when there's nothing to compare with. */
export function change(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : null;
}

/** "+12%", "−8%", "0%"; a true minus sign so screen readers say "minus". */
export function formatChange(fraction: number) {
  const pct = Math.round(fraction * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "8 Oct". */
export const formatDay = (iso: string) => day.format(at(iso));
/** "8 Oct 2026". */
export const formatDate = (iso: string) => dayYear.format(at(iso));
/** "Oct". */
export const formatMonthShort = (iso: string) => monthShort.format(at(iso));
/** "October 2026". */
export const formatMonth = (iso: string) => monthYear.format(at(iso));
/** "Monday" for ISO day 1. 2024-01-01 was a Monday. */
export const formatWeekday = (isoDay: number) =>
  weekday.format(new Date(Date.UTC(2024, 0, isoDay)));

/** "8 Oct – 6 Nov 2026", or one day when they match. */
export function formatSpan(from: string, to: string) {
  if (from === to) return formatDate(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? formatDay(from) : formatDate(from)} – ${formatDate(to)}`;
}

/**
 * Up to about five evenly spaced axis ticks from zero, each step 1, 2 or 5
 * times a power of ten.
 */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = 0; t < max + step; t += step) {
    ticks.push(Number(t.toPrecision(12)));
    if (t >= max) break;
  }
  return ticks;
}
