import { ocrModel, OCR_MODELS } from "@receipt-ocr/ai/models";
import { threeLetterMonth } from "@/lib/format";

/** Display helpers for the Operations and Jobs pages. Pure, so server and client share them. */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const integer = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Micro-USD as dollars; amounts under a cent keep four decimals so they don't read as $0.00. */
export function formatUsd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  return dollars !== 0 && Math.abs(dollars) < 0.01 ? usdSmall.format(dollars) : usd.format(dollars);
}

export const formatCount = (n: number) => integer.format(n);
/** Full under 10,000, compact above (axis ticks). */
export const formatTick = (n: number) =>
  Math.abs(n) < 10_000 ? integer.format(n) : compact.format(n);

/** "850 ms", "4.2 s". */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "–";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** "45 s", "12 min", "3 h 5 min", "2 d". */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) {
    const m = Math.floor((s % 3600) / 60);
    return `${Math.floor(s / 3600)} h${m ? ` ${m} min` : ""}`;
  }
  return `${Math.floor(s / 86_400)} d`;
}

export const formatPercent = (ratio: number | null | undefined, digits = 1) =>
  ratio == null ? "–" : `${(ratio * 100).toFixed(digits)}%`;

/** Signed change against the previous period, or null when there is nothing to compare. */
export function formatDelta(current: number, previous: number | null | undefined): string | null {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? "No change" : "New this period";
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return "No change";
  return `${change > 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)}% vs previous period`;
}

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A bucket key (`YYYY-MM-DDTHH` or `YYYY-MM-DD`) as an axis label: "14:00" or "6 Nov". */
export function bucketLabel(key: string): string {
  const date = key.length > 10 ? new Date(`${key}:00:00Z`) : new Date(`${key}T00:00:00Z`);
  return key.length > 10 ? hourFormat.format(date) : threeLetterMonth(dayFormat.format(date));
}

/** Longer form for tooltips and tables: "6 Nov, 14:00 UTC" or "6 Nov". */
export function bucketTitle(key: string): string {
  return key.length > 10
    ? `${threeLetterMonth(dayFormat.format(new Date(`${key}:00:00Z`)))}, ${bucketLabel(key)} UTC`
    : bucketLabel(key);
}

/** "Gemini 3.8 Flash" for a known model id, else the id itself. */
export const modelLabel = (id: string) => ocrModel(id)?.label ?? id;

/**
 * Categorical slot for a model: its position in the model catalogue, so a
 * model keeps its colour whichever models the range happens to contain.
 */
export function modelSlot(id: string, others: readonly string[]): number {
  const known = OCR_MODELS.findIndex((m) => m.id === id);
  if (known >= 0) return known;
  const unknown = others.filter((m) => !ocrModel(m)).sort();
  return OCR_MODELS.length + unknown.indexOf(id);
}

/** Short failure-kind labels, in plain words. */
const KIND_LABELS: Record<string, string> = {
  timeout: "Timed out",
  "rate-limited": "Rate limited",
  "provider-error": "Provider error",
  "invalid-output": "Unreadable answer",
  "bad-image": "Bad image",
  "not-configured": "Not configured",
  "storage-error": "Storage error",
  "lease-expired": "Worker lost",
  cancelled: "Cancelled",
  superseded: "Replaced by a retry",
};
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;
