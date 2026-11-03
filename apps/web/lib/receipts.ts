import "server-only";
import { parseCategory } from "@receipt-ocr/ai/categories";
import {
  getReceiptWithImage,
  NEEDS_REVIEW_BELOW,
  ReceiptRepo,
  type ReceiptExportRow,
  type ReceiptFilters,
  type ReceiptSummary as CoreReceiptSummary,
  type ReceiptWithItems,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { mockReceipts } from "./mock-data";
import { runtime } from "./runtime";
import { getActiveScope } from "./session";

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "@receipt-ocr/ai/categories";
export { getUsageSummary, type UsageSummary } from "./quota";

export type ReceiptSummary = CoreReceiptSummary;

export type ReceiptListFilters = {
  q?: string;
  category?: string;
  status?: ReceiptSummary["status"] | "needs-review";
  /** Inclusive receipt-date bounds, YYYY-MM-DD. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type ReceiptSummaryPage = {
  rows: ReceiptSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export const HISTORY_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const STATUSES = new Set(["uploaded", "processing", "completed", "failed", "needs-review"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Drops anything malformed, so URL params can be passed straight through. */
export function cleanFilters(input: ReceiptListFilters): ReceiptFilters {
  const q = input.q?.trim().slice(0, 100);
  return {
    q: q || undefined,
    // Old free-text values in a URL still find canonical rows.
    category: input.category ? (parseCategory(input.category) ?? input.category) : undefined,
    status: input.status && STATUSES.has(input.status) ? input.status : undefined,
    from: input.from && ISO_DATE.test(input.from) ? input.from : undefined,
    to: input.to && ISO_DATE.test(input.to) ? input.to : undefined,
  };
}

/** Filters from URL search params (History page and the export route share these). */
export function filtersFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): ReceiptListFilters {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return (Array.isArray(value) ? value[0] : value) ?? undefined;
  };
  const page = Number.parseInt(get("page") ?? "", 10);
  return {
    q: get("q"),
    category: get("category"),
    status: get("status") as ReceiptListFilters["status"],
    from: get("from"),
    to: get("to"),
    page: Number.isFinite(page) ? page : undefined,
  };
}

/**
 * Preview mode: with no session, workspace or database the app renders
 * sample data so the UI is explorable without credentials. This is the only
 * case that returns mock receipts; a real query that fails throws.
 */
function previewSummaries(): ReceiptSummary[] {
  return mockReceipts.map((receipt) => ({
    id: receipt.id,
    status: receipt.status as ReceiptSummary["status"],
    merchant: receipt.merchant,
    receiptDate: receipt.receiptDate,
    category: receipt.category,
    currency: "USD",
    total: receipt.total,
    confidence: Number(receipt.confidence),
    fileName: null,
    errorMessage: null,
    createdAt: new Date(),
  }));
}

function matchesPreview(row: ReceiptSummary, filters: ReceiptFilters): boolean {
  const q = filters.q?.toLowerCase();
  if (q && !row.merchant?.toLowerCase().includes(q)) return false;
  if (filters.category && row.category !== filters.category) return false;
  if (filters.status === "needs-review") {
    if (row.status !== "completed" || (row.confidence ?? 1) >= NEEDS_REVIEW_BELOW) return false;
  } else if (filters.status && row.status !== filters.status) return false;
  if (filters.from && (row.receiptDate ?? "") < filters.from) return false;
  if (filters.to && (row.receiptDate ?? "9999") > filters.to) return false;
  return true;
}

/** Server-side search and filtering of the active workspace's receipts, one page at a time. */
export async function listReceiptSummaries(filters: ReceiptListFilters): Promise<ReceiptSummaryPage> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(filters.pageSize ?? HISTORY_PAGE_SIZE)));
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const clean = cleanFilters(filters);

  const scope = await getActiveScope();
  if (!scope || !process.env.DATABASE_URL) {
    const all = previewSummaries().filter((row) => matchesPreview(row, clean));
    return { rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
  }

  const { rows, total } = await runtime.runPromise(
    Effect.flatMap(ReceiptRepo, (repo) =>
      repo.list(scope, clean, { limit: pageSize, offset: (page - 1) * pageSize }),
    ),
  );
  return { rows, total, page, pageSize };
}

export const MAX_EXPORT_ROWS = 5000;

/** Rows for the CSV export: the same filters as History, up to MAX_EXPORT_ROWS. */
export const exportRows = (scope: { organizationId: string; userId: string }, filters: ReceiptListFilters) =>
  Effect.flatMap(ReceiptRepo, (repo) => repo.exportRows(scope, cleanFilters(filters), MAX_EXPORT_ROWS + 1)).pipe(
    Effect.map((rows): { rows: ReceiptExportRow[]; truncated: boolean } => ({
      rows: rows.slice(0, MAX_EXPORT_ROWS),
      truncated: rows.length > MAX_EXPORT_ROWS,
    })),
  );

function mockToReceipt(id: string): ReceiptWithItems | null {
  const receipt = mockReceipts.find((item) => item.id === id) ?? mockReceipts[0];
  if (!receipt) return null;
  return {
    id: receipt.id,
    organizationId: "demo",
    userId: "demo",
    merchant: receipt.merchant,
    receiptDate: receipt.receiptDate,
    category: receipt.category,
    currency: "USD",
    subtotal: null,
    tax: receipt.tax,
    tip: null,
    total: receipt.total,
    confidence: receipt.confidence,
    status: receipt.status as ReceiptWithItems["status"],
    fileName: null,
    imageObjectKey: null,
    storageSource: "managed",
    rawJson: receipt,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: receipt.items.map((item) => ({ ...item, receiptId: receipt.id })),
  };
}

export async function getReceiptForWorkspace(id: string): Promise<ReceiptWithItems | null> {
  const scope = await getActiveScope();
  if (!scope || !process.env.DATABASE_URL) return mockToReceipt(id);
  return runtime.runPromise(getReceiptWithImage({ receiptId: id, scope }));
}

/**
 * @deprecated Use `listReceiptSummaries`. Kept for the current History page:
 * summaries shaped as receipts, without items.
 */
export async function listReceiptsForWorkspace(
  page = 1,
): Promise<{ receipts: ReceiptWithItems[]; total: number }> {
  const result = await listReceiptSummaries({ page });
  return {
    total: result.total,
    receipts: result.rows.map((row) => ({
      ...row,
      organizationId: "",
      userId: "",
      subtotal: null,
      tax: null,
      tip: null,
      confidence: row.confidence == null ? null : String(row.confidence),
      imageObjectKey: null,
      storageSource: "managed",
      rawJson: null,
      updatedAt: row.createdAt,
      items: [],
    })),
  };
}
