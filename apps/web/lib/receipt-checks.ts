import type { ReceiptWithItems } from "@receipt-ocr/core";
import { confidenceLevel, formatConfidence } from "@/lib/format";

type CheckedReceipt = Pick<
  ReceiptWithItems,
  | "confidence"
  | "imageObjectKey"
  | "merchant"
  | "receiptDate"
  | "subtotal"
  | "tax"
  | "tip"
  | "total"
  | "items"
>;

/** "photo" or "PDF", so failure and review copy names what the person actually uploaded. */
export function fileNoun(receipt: { imageObjectKey: string | null }) {
  return receipt.imageObjectKey?.endsWith(".pdf") ? "PDF" : "photo";
}

function toNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CENT = 0.01;

/**
 * The amount the receipt's parts add up to, when no reading of them matches the
 * total; null when one does or there is nothing to compare. Negative lines are
 * discounts and already reduce the item sum. A total equal to the subtotal or
 * the item sum (with or without the tip) means the prices include tax, so tax
 * isn't added on top.
 */
export function totalsMismatch(receipt: CheckedReceipt): number | null {
  const total = toNumber(receipt.total);
  if (total === null) return null;
  const itemsSum = receipt.items.length
    ? receipt.items.reduce((sum, item) => sum + (toNumber(item.totalPrice) ?? 0), 0)
    : null;
  const subtotal = toNumber(receipt.subtotal);
  const bases = [subtotal, itemsSum].filter((base) => base !== null);
  if (bases.length === 0) return null;
  const tax = toNumber(receipt.tax) ?? 0;
  const tip = toNumber(receipt.tip) ?? 0;
  const matches = bases.some((base) =>
    [base, base + tip, base + tax + tip].some((sum) => Math.abs(sum - total) < CENT),
  );
  if (matches) return null;
  return Math.round((bases[0]! + tax + tip) * 100) / 100;
}

/** Everything a person should look at before trusting this receipt, in plain words. */
export function checksFor(receipt: CheckedReceipt, money: (value: string | null) => string | null) {
  const checks: string[] = [];
  const level = confidenceLevel(receipt.confidence);
  if (level === "review" || level === "check") {
    checks.push(
      `Overall confidence is ${formatConfidence(receipt.confidence)}. Compare the merchant, date and total with the ${fileNoun(receipt)}.`,
    );
  }
  const lowLines = receipt.items.filter((item) => confidenceLevel(item.confidence) === "review");
  if (lowLines.length > 0) {
    checks.push(
      lowLines.length === 1
        ? "1 line was hard to read. It's marked in Line items."
        : `${lowLines.length} lines were hard to read. They're marked in Line items.`,
    );
  }
  const expected = totalsMismatch(receipt);
  if (expected !== null) {
    checks.push(
      `The amounts add up to ${money(expected.toFixed(2))}, but the total says ${money(receipt.total)}. A discount, a coupon or tax already included in the prices often explains this.`,
    );
  }
  if (!receipt.merchant) checks.push("No merchant name was found.");
  if (!receipt.receiptDate) checks.push("No date was found.");
  if (toNumber(receipt.total) === null) checks.push("No total was found.");
  return checks;
}
