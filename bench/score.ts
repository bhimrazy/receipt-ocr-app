// Field-level scoring of an extraction against ground truth. Pure, so it is unit-tested.
import { parseCategory } from "@receipt-ocr/ai/categories";

export type Item = { name: string; quantity?: number; unitPrice?: number; totalPrice?: number };
export type Receipt = {
  merchant?: string | null;
  receiptDate?: string | null;
  /** One category, or every acceptable one for a receipt that honestly fits several. */
  category?: string | readonly string[] | null;
  currency?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  total?: number | null;
  items?: readonly Item[];
};

export const EXACT_FIELDS = ["currency", "receiptDate", "category"] as const;
/** What a model returned: always a single category. */
export type Predicted = Omit<Receipt, "category"> & { category?: string | null };
export const AMOUNT_FIELDS = ["total", "tax", "subtotal", "tip"] as const;
const AMOUNT_TOLERANCE = 0.01;
const MERCHANT_THRESHOLD = 0.8;
const ITEM_NAME_THRESHOLD = 0.7;

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function levenshtein(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** 1 for identical (after normalising case and punctuation), 0 for nothing in common. */
export function similarity(a: string, b: string) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x && !y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export function itemsF1(truth: readonly Item[], predicted: readonly Item[]) {
  const unused = new Set(predicted.keys());
  let hits = 0;
  for (const t of truth) {
    let best = -1;
    let bestScore = 0;
    for (const i of unused) {
      const p = predicted[i]!;
      const priceOk = Math.abs((p.totalPrice ?? NaN) - (t.totalPrice ?? NaN)) <= AMOUNT_TOLERANCE;
      const score = similarity(t.name, p.name);
      if (priceOk && score >= ITEM_NAME_THRESHOLD && score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best >= 0) {
      unused.delete(best);
      hits++;
    }
  }
  const precision = predicted.length ? hits / predicted.length : truth.length ? 0 : 1;
  const recall = truth.length ? hits / truth.length : 1;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** The app's canonical category, so a legacy label ("Restaurant") compares as "Meals". */
const canonical = (value: string | null | undefined) =>
  value == null ? value : (parseCategory(value) ?? value);

function categoryMatches(truth: Receipt["category"], got: string | null | undefined) {
  const accepted = Array.isArray(truth) ? truth : [truth];
  return accepted.some((want) => canonical(want) === canonical(got));
}

/** Per-field pass/fail (1 or 0); fields absent from the ground truth are skipped. */
export function scoreReceipt(truth: Receipt, predicted: Predicted) {
  const fields: Record<string, number> = {};
  for (const f of EXACT_FIELDS) {
    if (truth[f] === undefined) continue;
    const ok =
      f === "category"
        ? categoryMatches(truth.category, predicted.category)
        : truth[f] === predicted[f];
    fields[f] = ok ? 1 : 0;
  }
  for (const f of AMOUNT_FIELDS) {
    if (truth[f] === undefined) continue;
    const want = truth[f];
    const got = predicted[f];
    // Absent and zero are the same statement on a receipt ("no tip").
    const ok =
      want === null || want === 0
        ? got === null || got === undefined || got === 0
        : typeof got === "number" && Math.abs(got - want) <= AMOUNT_TOLERANCE;
    fields[f] = ok ? 1 : 0;
  }
  if (truth.merchant != null) {
    fields.merchant =
      similarity(truth.merchant, predicted.merchant ?? "") >= MERCHANT_THRESHOLD ? 1 : 0;
  }
  if (truth.items) fields.itemsF1 = itemsF1(truth.items, predicted.items ?? []);
  return fields;
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
