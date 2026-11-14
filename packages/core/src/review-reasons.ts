/**
 * Why a completed receipt needs a person to look at it, as stored in `receipts.review_reasons`. "Needs review" is
 * `status = 'completed' AND review_reasons <> '{}' AND reviewed_at IS NULL`. Client-safe: no server imports.
 */

import type { DateReason } from "@receipt-ocr/calendar";

export const REVIEW_REASONS = [
  "no_merchant",
  "no_date",
  "no_total",
  "no_currency",
  "totals_mismatch",
  "date_ambiguous",
  "date_conflict",
  "date_implausible",
  // Set only by migration 0003 on receipts below 0.9 confidence; completions don't add it, and edits keep it.
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
  // A whole-number total may be rounded to the unit (NPR bills round to the rupee): any gap under 1.00 passes.
  const slack = total % 100 === 0 ? 99 : 0;
  const matches = bases.some((base) =>
    [base - discount, base].some((net) =>
      [net, net + tip, net + tax + tip].some((sum) => Math.abs(sum + service - total) <= slack),
    ),
  );
  if (matches) return null;
  return (bases[0]! - discount + service + tax + tip) / 100;
}

const minorDigits = new Map<string, number>();

function minorUnitDigits(currency: string | null | undefined): number {
  if (!currency) return 2;
  let digits = minorDigits.get(currency);
  if (digits === undefined) {
    try {
      digits =
        new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
          .maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    minorDigits.set(currency, digits);
  }
  return digits;
}

function amount(value: Amount): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a line's own numbers disagree: its total is missing, or quantity × unit price differs from the total by
 * more than rounding. The allowance is half the currency's minor unit, scaled up for quantities above 1 because a
 * printed unit price is itself rounded. A line without a unit price can't be checked beyond having a total.
 * Never reads the model's confidence, and never compares lines with the subtotal (`totals_mismatch` does).
 *
 * Stored quantities are whole numbers, so a weighed line (0.75 kg) is stored as 1. `printedQuantity` is the
 * unrounded quantity from the extraction. Without it, a mismatch whose total is a non-integer multiple of the
 * unit price is taken as a fractional quantity and not marked.
 */
export function lineNeedsCheck(
  item: { quantity: number | string | null; unitPrice: Amount; totalPrice: Amount },
  currency: string | null | undefined,
  printedQuantity?: number | null,
): boolean {
  const total = amount(item.totalPrice);
  if (total === null) return true;
  const unit = amount(item.unitPrice);
  const exact =
    typeof printedQuantity === "number" && Number.isFinite(printedQuantity) && printedQuantity > 0;
  const quantity = exact ? printedQuantity : Number(item.quantity);
  if (unit === null || !Number.isFinite(quantity) || quantity <= 0) return false;
  const minor = 10 ** -minorUnitDigits(currency);
  const allowance = 0.5 * Math.max(1, quantity) * minor;
  if (Math.abs(quantity * unit - total) <= allowance + 1e-9) return false;
  if (exact || unit === 0) return true;
  const ratio = total / unit;
  return Math.abs(ratio - Math.round(ratio)) < 0.005;
}

/** Items with `needsCheck` set; `rawJson` supplies the unrounded quantities, matched by printed order. */
export function withLineChecks<
  T extends { quantity: number; unitPrice: Amount; totalPrice: Amount },
>(
  items: readonly T[],
  currency: string | null | undefined,
  rawJson: unknown,
): (T & { needsCheck: boolean })[] {
  const printed = (rawJson as { items?: unknown } | null)?.items;
  return items.map((item, index) => {
    const raw = Array.isArray(printed) ? (printed[index] as { quantity?: unknown } | null) : null;
    const quantity = typeof raw?.quantity === "number" ? raw.quantity : null;
    return { ...item, needsCheck: lineNeedsCheck(item, currency, quantity) };
  });
}

/**
 * Every reason a completed receipt needs review, in `REVIEW_REASONS` order. `dateReasons` come from the date
 * resolver, which needs the printed text; the rest are computed from the fields. Edits go through `editedReasons`.
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

type EditableField = Exclude<keyof CheckedFields, "items"> | "receiptDateCalendar";

const AMOUNTS: EditableField[] = ["subtotal", "tax", "tip", "discount", "serviceCharge", "total"];

/** The fields each check reads. A reason whose fields an edit didn't change is kept as it was. */
const DEPENDS_ON: Partial<Record<ReviewReason, readonly EditableField[]>> = {
  no_merchant: ["merchant"],
  no_date: ["receiptDate"],
  no_total: ["total"],
  no_currency: ["currency"],
  totals_mismatch: AMOUNTS,
};

/**
 * The reasons after an edit. Only checks that read a changed field are recomputed; the rest, `low_confidence`
 * and codes this version doesn't know included, are kept. A changed date or calendar was set by a person, so the
 * resolver's date reasons go.
 */
export function editedReasons(
  previous: readonly string[],
  fields: CheckedFields,
  changed: ReadonlySet<string>,
): string[] {
  const dateSet = changed.has("receiptDate") || changed.has("receiptDateCalendar");
  const now = new Set<string>(reviewReasons(fields));
  const keep = (reason: string) => {
    if (isDateReason(reason)) return !dateSet;
    const fieldsRead = DEPENDS_ON[reason as ReviewReason];
    return fieldsRead ? !fieldsRead.some((field) => changed.has(field)) : true;
  };
  const kept = previous.filter(keep);
  const added = [...now].filter((reason) => {
    const fieldsRead = DEPENDS_ON[reason as ReviewReason];
    return fieldsRead?.some((field) => changed.has(field)) ?? false;
  });
  const result = new Set([...kept, ...added]);
  const known = REVIEW_REASONS.filter((reason) => result.has(reason));
  return [
    ...known,
    ...[...result].filter((reason) => !(REVIEW_REASONS as readonly string[]).includes(reason)),
  ];
}
