/**
 * Why a completed receipt needs a person to look at it, as stored in `receipts.review_reasons`. "Needs review" is
 * `status = 'completed' AND review_reasons <> '{}' AND reviewed_at IS NULL`. Client-safe: no server imports.
 */

import type { DateReason } from "./calendar/resolve";

export const REVIEW_REASONS = [
  "no_merchant",
  "no_date",
  "no_total",
  "no_currency",
  "totals_mismatch",
  "date_ambiguous",
  "date_conflict",
  "date_implausible",
  // Only from migration 0003, for receipts the old confidence rule flagged; nothing writes it now.
  "low_confidence",
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

const DATE_REASONS: readonly string[] = ["date_ambiguous", "date_conflict", "date_implausible"];

export const isDateReason = (reason: string): reason is DateReason => DATE_REASONS.includes(reason);

type Amount = string | null | undefined;

/** The stored fields the checks read; amounts as `numeric` strings. */
export type CheckedFields = {
  merchant: string | null;
  receiptDate: string | null;
  currency: string | null;
  subtotal: Amount;
  tax: Amount;
  tip: Amount;
  discount: Amount;
  serviceCharge: Amount;
  total: Amount;
  items: readonly { totalPrice: Amount }[];
};

/** Whole cents, so sums compare exactly instead of within a float tolerance. */
function cents(value: Amount): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * What the parts add up to when no reading of them matches the total to the cent; null when one does or there is
 * nothing to compare. The base is the subtotal or the item sum; then `− discount + service charge + tax + tip`.
 * Tax and tip may be left out (prices that include tax, a tip not in the total), and so may the discount, because
 * a discount line in the items already reduces their sum.
 */
export function totalsMismatch(fields: CheckedFields): number | null {
  const total = cents(fields.total);
  if (total === null) return null;
  const itemsSum = fields.items.length
    ? fields.items.reduce((sum, item) => sum + (cents(item.totalPrice) ?? 0), 0)
    : null;
  const bases = [cents(fields.subtotal), itemsSum].filter((base) => base !== null);
  if (bases.length === 0) return null;
  const discount = cents(fields.discount) ?? 0;
  const service = cents(fields.serviceCharge) ?? 0;
  const tax = cents(fields.tax) ?? 0;
  const tip = cents(fields.tip) ?? 0;
  const matches = bases.some((base) =>
    [base - discount, base].some((net) =>
      [net, net + tip, net + tax + tip].some((sum) => sum + service === total),
    ),
  );
  if (matches) return null;
  return (bases[0]! - discount + service + tax + tip) / 100;
}

/**
 * Every reason a receipt needs review, in `REVIEW_REASONS` order. `dateReasons` come from the date resolver, which
 * needs the printed text; the rest are recomputed from the fields. The one place these checks are decided: at
 * completion and on every edit.
 */
export function reviewReasons(
  fields: CheckedFields,
  dateReasons: readonly DateReason[] = [],
): ReviewReason[] {
  const found = new Set<ReviewReason>(dateReasons);
  if (!fields.merchant?.trim()) found.add("no_merchant");
  if (!fields.receiptDate && !found.has("date_implausible")) found.add("no_date");
  if (cents(fields.total) === null) found.add("no_total");
  if (!fields.currency) found.add("no_currency");
  if (totalsMismatch(fields) !== null) found.add("totals_mismatch");
  return REVIEW_REASONS.filter((reason) => found.has(reason));
}
