import type { ReceiptExportRow } from "@receipt-ocr/core";
import { receiptsToCsv } from "@/lib/csv";
import type { ContentExample } from "./types";

// Fixed so the sample CSV is the same on every render.
const SAMPLE_IDS = [
  "6f1c2a9e-4b7d-4e21-9a3f-2d8c51e0b7a4",
  "a83e5d10-92c4-4f6b-b1d7-7c0e3f9a2b58",
  "d2b7f4c1-3e8a-4a95-8c26-1f5e9b0d7c33",
];
const SAMPLE_CREATED = new Date("2026-10-29T09:12:00Z");

/** The example as History CSV rows: the receipt shown, then `historyRows`. */
export function exampleCsv(example: ContentExample): string {
  const { items, ...head } = example.extraction;
  const rows = [
    { ...head, itemCount: items.length, fileName: example.fileName },
    ...(example.historyRows ?? []),
  ];
  const money = (n: number | null) => (n === null ? null : n.toFixed(2));
  return receiptsToCsv(
    rows.map((row, i): ReceiptExportRow => ({
      id: SAMPLE_IDS[i % SAMPLE_IDS.length]!,
      status: "completed",
      merchant: row.merchant,
      receiptDate: row.receiptDate,
      category: row.category,
      currency: row.currency,
      subtotal: money(row.subtotal),
      tax: money(row.tax),
      tip: money(row.tip),
      total: money(row.total),
      confidence: row.confidence,
      itemCount: row.itemCount,
      groups: example.groups ?? [],
      userId: null,
      reviewedAt: null,
      fileName: row.fileName,
      errorMessage: null,
      createdAt: SAMPLE_CREATED,
    })),
  );
}
