import "server-only";
import { parseCategory } from "@receipt-ocr/ai/categories";
import {
  getReceiptWithImage,
  ReceiptRepo,
  type ReceiptCounts,
  type ReceiptExportRow,
  type ReceiptFilters,
  type ReceiptSummary as CoreReceiptSummary,
  type ReceiptWithItems,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { runtime } from "./runtime";
import { requireActiveScope } from "./session";

export type { ReceiptStatus } from "@receipt-ocr/core";
export { getUsageSummary, type UsageSummary } from "./quota";

export type ReceiptSummary = CoreReceiptSummary;

/** The History search and filters, as they appear in the URL and the toolbar. */
export type HistoryFilters = ReceiptFilters;

export type ReceiptListFilters = HistoryFilters & {
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

/** Server-side search and filtering of the active workspace's receipts, one page at a time. */
export async function listReceiptSummaries(
  filters: ReceiptListFilters,
): Promise<ReceiptSummaryPage> {
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(filters.pageSize ?? HISTORY_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const clean = cleanFilters(filters);

  const scope = await requireActiveScope();
  const { rows, total } = await runtime.runPromise(
    Effect.flatMap(ReceiptRepo, (repo) =>
      repo.list(scope, clean, { limit: pageSize, offset: (page - 1) * pageSize }),
    ),
  );
  return { rows, total, page, pageSize };
}

export const MAX_EXPORT_ROWS = 5000;

/** Rows for the CSV export: the same filters as History, up to MAX_EXPORT_ROWS. */
export const exportRows = (
  scope: { organizationId: string; userId: string },
  filters: ReceiptListFilters,
) =>
  Effect.flatMap(ReceiptRepo, (repo) =>
    repo.exportRows(scope, cleanFilters(filters), MAX_EXPORT_ROWS + 1),
  ).pipe(
    Effect.map((rows): { rows: ReceiptExportRow[]; truncated: boolean } => ({
      rows: rows.slice(0, MAX_EXPORT_ROWS),
      truncated: rows.length > MAX_EXPORT_ROWS,
    })),
  );

export async function getReceiptForWorkspace(id: string): Promise<ReceiptWithItems | null> {
  const scope = await requireActiveScope();
  return runtime.runPromise(getReceiptWithImage({ receiptId: id, scope }));
}

/** Counts for the home screen, across the whole workspace. */
export async function getReceiptCounts(): Promise<ReceiptCounts> {
  const scope = await requireActiveScope();
  return runtime.runPromise(Effect.flatMap(ReceiptRepo, (repo) => repo.counts(scope)));
}
