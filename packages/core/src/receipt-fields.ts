/**
 * Normalising the receipt fields `receipts` constrains, before they are
 * written. The bounds match the table's CHECKs, so a value that passes here
 * can't fail the write (the repository applies the date's upper bound in SQL,
 * against the row's own upload time). Client-safe: no server imports.
 */

/** Earliest receipt date accepted, as in `receipts_receipt_date_check`. */
export const EARLIEST_RECEIPT_DATE = "2000-01-01";

/** The latest date a receipt uploaded at `createdAt` may carry: the day after its UTC upload day. */
export function latestReceiptDate(createdAt: Date | string): string {
  return new Date(new Date(createdAt).getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whether `value` is a real `YYYY-MM-DD` calendar day (years 100 to 9999), so
 * a `::date` cast can't throw on it. `2026-02-30` is not.
 */
export function isIsoDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * A real `YYYY-MM-DD` calendar day from 2000 on, else null. `2026-02-30`, a
 * day-first `14/09/26` and a timestamp are all null: nothing guesses an order.
 */
export function parseReceiptDate(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return isIsoDay(text) && text >= EARLIEST_RECEIPT_DATE ? text : null;
}

/** Largest magnitude in cents a `numeric(12,2)` column holds: 9,999,999,999.99. */
const MAX_AMOUNT_CENTS = 999_999_999_999;

/**
 * An amount as a `numeric(12,2)` literal, or null when it is missing or would
 * overflow the column once rounded to cents. A misread barcode or card number
 * becomes "not read" instead of failing the whole receipt.
 */
export function storableAmount(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.abs(value) * 100) <= MAX_AMOUNT_CENTS ? String(value) : null;
}

/** Largest item quantity kept; anything above is a misread. */
export const MAX_ITEM_QUANTITY = 1_000_000;

/**
 * An item quantity in whole units for `receipt_items.quantity`: at least 1, and
 * 1 (none printed) for a missing or implausible value, so it always fits `int4`.
 */
export function storableQuantity(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 1;
  const units = Math.round(value);
  return units > MAX_ITEM_QUANTITY ? 1 : Math.max(1, units);
}

/** An ISO 4217-shaped code in upper case, else null (shown as USD, as before). */
export function parseCurrency(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
