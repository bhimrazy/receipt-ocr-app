import type { ReceiptExportRow } from "@receipt-ocr/core";
import { earlierRows, samples } from "./fixtures";

const money = (value: number | null) => (value === null ? null : value.toFixed(2));

/**
 * The sample workspace as export rows, newest first. Feeds the Export preview and
 * public/sample-receipts.csv (kept in sync by sample-export.test.ts).
 */
export const sampleExportRows: ReceiptExportRow[] = [
  ...samples.map((s) => ({ ...s, itemCount: s.items.length })),
  ...earlierRows,
]
  .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate))
  .map((r, index): ReceiptExportRow => ({
    id: `sample-${String(index + 1).padStart(2, "0")}`,
    status: "completed",
    merchant: r.merchant,
    receiptDate: r.receiptDate,
    category: r.category,
    currency: "USD",
    subtotal: money(r.subtotal),
    tax: money(r.tax),
    tip: money(r.tip),
    total: money(r.total),
    confidence: r.confidence,
    itemCount: r.itemCount,
    groups: [],
    fileName: r.fileName,
    errorMessage: null,
    createdAt: new Date(`${r.receiptDate}T${r.time}:00Z`),
  }));
