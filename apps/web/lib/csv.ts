import type { ReceiptExportRow, ReceiptWithItems } from "@receipt-ocr/core";

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * RFC 4180 quoting. Also guards against CSV injection: a cell starting with
 * =, +, -, or @ is executed as a formula by Excel and Sheets, and receipt
 * merchant names come from OCR of an untrusted image. Plain numbers are left
 * alone so refunds (-5.00) stay numeric.
 */
/** Group names are typed by members: neutralise formula prefixes before they are joined into one cell. */
const guardFormula = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function row(values: unknown[]): string {
  return values.map(cell).join(",");
}

const RECEIPT_HEADERS = [
  "receipt_id",
  "status",
  "merchant",
  "receipt_date",
  "category",
  "currency",
  "subtotal",
  "tax",
  "tip",
  "total",
  "confidence",
  "items",
  "groups",
  "file_name",
  "created_at",
];

/** One row per receipt, with the line-item count. For the filtered export. */
export function receiptsToCsv(receipts: ReceiptExportRow[]): string {
  const lines = [row(RECEIPT_HEADERS)];
  for (const receipt of receipts) {
    lines.push(
      row([
        receipt.id,
        receipt.status,
        receipt.merchant,
        receipt.receiptDate,
        receipt.category,
        receipt.currency,
        receipt.subtotal,
        receipt.tax,
        receipt.tip,
        receipt.total,
        receipt.confidence,
        receipt.itemCount,
        receipt.groups.map(guardFormula).join("; "),
        receipt.fileName,
        receipt.createdAt instanceof Date ? receipt.createdAt.toISOString() : receipt.createdAt,
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

const ITEM_HEADERS = [
  "receipt_id",
  "merchant",
  "receipt_date",
  "item",
  "quantity",
  "unit_price",
  "total_price",
  "confidence",
];

/** One row per line item. For a single receipt's "Export CSV". */
export function receiptItemsToCsv(receipt: ReceiptWithItems): string {
  const lines = [row(ITEM_HEADERS)];
  for (const item of receipt.items) {
    lines.push(
      row([
        receipt.id,
        receipt.merchant,
        receipt.receiptDate,
        item.name,
        item.quantity,
        item.unitPrice,
        item.totalPrice,
        item.confidence,
      ]),
    );
  }
  // Totals belong in the export too, otherwise tax and tip are lost.
  lines.push(
    row([
      receipt.id,
      receipt.merchant,
      receipt.receiptDate,
      "Subtotal",
      "",
      "",
      receipt.subtotal,
      "",
    ]),
  );
  lines.push(
    row([receipt.id, receipt.merchant, receipt.receiptDate, "Tax", "", "", receipt.tax, ""]),
  );
  lines.push(
    row([receipt.id, receipt.merchant, receipt.receiptDate, "Tip", "", "", receipt.tip, ""]),
  );
  lines.push(
    row([receipt.id, receipt.merchant, receipt.receiptDate, "Total", "", "", receipt.total, ""]),
  );
  return `${lines.join("\n")}\n`;
}

/** Safe, descriptive download filename. */
export function csvFilename(prefix: string, label?: string | null): string {
  const slug = (label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  return [prefix, slug, date].filter(Boolean).join("-") + ".csv";
}
