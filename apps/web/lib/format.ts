// Fixed locale and time zone so server and client render identical strings
// (a runtime-default locale causes hydration mismatches).
const LOCALE = "en-GB";
const TIME_ZONE = "UTC";

function toNumber(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

// Intl constructors are slow; build each formatter once per process.
const currencyFormatters = new Map<string, Intl.NumberFormat | null>();

function currencyFormatter(currency: string) {
  const cached = currencyFormatters.get(currency);
  if (cached !== undefined) return cached;
  let formatter: Intl.NumberFormat | null;
  try {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
  } catch {
    // An unknown code from OCR or a manual edit; fall back to the code itself.
    formatter = null;
  }
  currencyFormatters.set(currency, formatter);
  return formatter;
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});

/** Legacy: treats missing values as zero. Prefer `formatMoney` for display. */
export function money(value?: string | number | null, currency = "USD") {
  return formatMoney(value ?? 0, currency) ?? formatMoney(0, currency) ?? "0.00";
}

/** Amount with the currency symbol, or null when there is no amount to show. */
export function formatMoney(
  value: string | number | null | undefined,
  currency = "USD",
): string | null {
  const amount = toNumber(value);
  if (amount === null) return null;
  const formatter = currencyFormatter(currency.toUpperCase());
  if (formatter) return formatter.format(amount);
  return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
}

/** Legacy: 0–1 confidence as a percentage, missing as 0%. */
export function pct(value?: string | number | null) {
  const amount = Number(value ?? 0);
  return `${Math.round(amount * 100)}%`;
}

/** "27 Oct 2026". Accepts an ISO date (YYYY-MM-DD), a timestamp or a Date. */
export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormatter.format(date);
}

/** "27 Oct 2026, 14:05 UTC". */
export function formatDateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = dateTimeFormatter.format(date);
  return `${formatted} UTC`;
}

/** "14:05 UTC". */
export function formatTime(value: Date): string {
  const formatted = timeFormatter.format(value);
  return `${formatted} UTC`;
}

export type ConfidenceLevel = "high" | "check" | "review";

/** Thresholds from the design review: >=90 high, 75–89 check, <75 review. */
export function confidenceLevel(value: string | number | null | undefined): ConfidenceLevel | null {
  const score = toNumber(value);
  if (score === null) return null;
  if (score >= 0.9) return "high";
  if (score >= 0.75) return "check";
  return "review";
}

/** 0–1 confidence as "92%", or null when unknown. */
export function formatConfidence(value: string | number | null | undefined): string | null {
  const score = toNumber(value);
  return score === null ? null : `${Math.round(score * 100)}%`;
}

/** "in 6 hours", "in 45 minutes": how long until `target`, rounded down to something readable. */
export function formatTimeUntil(target: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
