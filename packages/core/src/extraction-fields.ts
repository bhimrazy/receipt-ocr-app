/**
 * What a completed extraction stores: the model's reply, any prompt version, mapped to the `receipts` and
 * `receipt_items` values, with the date resolved and the review reasons computed. Pure and client-safe, so the
 * repository and the OCR benchmark score the same values.
 */

import { normalizeCategory, type ReceiptCategory } from "@receipt-ocr/ai/categories";
import type { ReceiptExtraction } from "@receipt-ocr/ai";
import { asciiDigits, resolveReceiptDate, type ReceiptCalendar } from "@receipt-ocr/calendar";
import { parseCurrency, storableAmount, storableQuantity } from "./receipt-fields";
import { reviewReasons, type ReviewReason } from "./review-reasons";

export type StoredItem = {
  /** Printed order, from the reply's array order. */
  position: number;
  name: string;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
  confidence: string;
};

export type StoredExtraction = {
  merchant: string | null;
  receiptDate: string | null;
  receiptDateCalendar: ReceiptCalendar | null;
  invoiceNumber: string | null;
  merchantTaxId: string | null;
  category: ReceiptCategory | null;
  currency: string | null;
  subtotal: string | null;
  tax: string | null;
  tip: string | null;
  discount: string | null;
  serviceCharge: string | null;
  total: string | null;
  confidence: string;
  reviewReasons: ReviewReason[];
  items: StoredItem[];
};

/** Printed text for a length-checked column, or null when missing or too long to be what was asked for. */
const boundedText = (value: unknown, max: number) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 && text.length <= max ? text : null;
};

/** For comparing printed identifiers only (`PAN: 123 456 789` and `123456789`); never stored. */
export const identifierKey = (value: string) =>
  asciiDigits(value.normalize("NFKC"))
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toUpperCase();

/** A discount or charge for a `>= 0` column: the model may sign a discount. */
const storableCharge = (value: number | null | undefined) =>
  value == null ? null : storableAmount(Math.abs(value));

/**
 * The stored values for `extraction` on a receipt uploaded on `uploadDay` (UTC, `YYYY-MM-DD`). The upload day
 * bounds the date, as `receipts_receipt_date_check` does. Throws only on a malformed `uploadDay`.
 */
export function storedExtraction(
  extraction: ReceiptExtraction,
  uploadDay: string,
): StoredExtraction {
  const merchantTaxId = boundedText(extraction.merchantTaxId, 32);
  const printedNumber = boundedText(extraction.invoiceNumber, 64);
  // The model took the seller's PAN for the bill number.
  const invoiceNumber =
    printedNumber && merchantTaxId && identifierKey(printedNumber) === identifierKey(merchantTaxId)
      ? null
      : printedNumber;
  const currency = parseCurrency(extraction.currency);
  const resolved = resolveReceiptDate({
    dates: Array.isArray(extraction.dates) ? extraction.dates : null,
    modelReading: extraction.receiptDate,
    uploadDay,
    currency,
    fiscalYearHints: [printedNumber],
  });
  const fields = {
    merchant: (typeof extraction.merchant === "string" && extraction.merchant.trim()) || null,
    receiptDate: resolved.date,
    currency,
    subtotal: storableAmount(extraction.subtotal),
    tax: storableAmount(extraction.tax),
    tip: storableAmount(extraction.tip),
    discount: storableCharge(extraction.discount),
    serviceCharge: storableCharge(extraction.serviceCharge),
    total: storableAmount(extraction.total),
  };
  const items = extraction.items.map((item, position) => ({
    position,
    name: item.name,
    quantity: storableQuantity(item.quantity),
    unitPrice: storableAmount(item.unitPrice),
    totalPrice: storableAmount(item.totalPrice),
    confidence: String(item.confidence),
  }));
  return {
    ...fields,
    receiptDateCalendar: resolved.calendar,
    invoiceNumber,
    merchantTaxId,
    category: normalizeCategory(extraction.category),
    confidence: String(extraction.confidence),
    reviewReasons: reviewReasons({ ...fields, items }, resolved.reasons),
    items,
  };
}
