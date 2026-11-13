import type { ReceiptExportRow, ReceiptWithItems } from "@receipt-ocr/core";
import { bsDotted, printedBsDate } from "@receipt-ocr/core/calendar";

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Group names are typed by members: neutralise formula prefixes before they are joined into one cell. */
const guardFormula = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

/**
 * RFC 4180 quoting. Also guards against CSV injection: a cell starting with
 * =, +, -, or @ is executed as a formula by Excel and Sheets, and receipt
 * merchant names come from OCR of an untrusted image. Plain numbers are left
 * alone so refunds (-5.00) stay numeric.
 */
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

/**
 * `2080.04.09` for a receipt that printed Bikram Sambat, else empty. Dotted, as Nepal's IRD billing API takes it;
 * a dashed `2080-04-09` would read as a Gregorian date in 2080 in a spreadsheet.
 */
const receiptDateBs = (receipt: {
  receiptDate: string | null;
  receiptDateCalendar: string | null;
}) => {
  const bs = printedBsDate(receipt.receiptDate, receipt.receiptDateCalendar);
  return bs ? bsDotted(bs) : null;
};

const RECEIPT_HEADERS = [
  "receipt_id",
  "status",
  "merchant",
  "receipt_date",
  "receipt_date_bs",
  "category",
  "currency",
  "subtotal",
  "discount",
  "service_charge",
  "tax",
  "tip",
  "total",
  "invoice_number",
  "merchant_tax_id",
  "confidence",
  "review_reasons",
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
        receiptDateBs(receipt),
        receipt.category,
        receipt.currency,
        receipt.subtotal,
        receipt.discount,
        receipt.serviceCharge,
        receipt.tax,
        receipt.tip,
        receipt.total,
        receipt.invoiceNumber,
        receipt.merchantTaxId,
        receipt.confidence,
        receipt.reviewReasons.join("; "),
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
  "receipt_date_bs",
  "item",
  "quantity",
  "unit_price",
  "total_price",
  "confidence",
];

/** One row per line item, in printed order. For a single receipt's "Export CSV". */
export function receiptItemsToCsv(receipt: ReceiptWithItems): string {
  const head = [receipt.id, receipt.merchant, receipt.receiptDate, receiptDateBs(receipt)];
  const lines = [row(ITEM_HEADERS)];
  for (const item of receipt.items) {
    lines.push(
      row([...head, item.name, item.quantity, item.unitPrice, item.totalPrice, item.confidence]),
    );
  }
  // Totals belong in the export too, otherwise tax and tip are lost.
  for (const [label, amount] of [
    ["Subtotal", receipt.subtotal],
    ["Discount", receipt.discount],
    ["Service charge", receipt.serviceCharge],
    ["Tax", receipt.tax],
    ["Tip", receipt.tip],
    ["Total", receipt.total],
  ] as const) {
    lines.push(row([...head, label, "", "", amount, ""]));
  }
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
