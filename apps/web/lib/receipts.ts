import "server-only";
import { parseCategory } from "@receipt-ocr/ai/categories";
import {
  getReceiptWithImage,
  isIsoDay,
  ReceiptRepo,
  type ReceiptCounts,
  type ReceiptExportRow,
  type ReceiptFilters,
  type ReceiptSummary as CoreReceiptSummary,
  type ReceiptWithItems,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { cache } from "react";
import { z } from "zod";
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
/** Highest History page served: keeps OFFSET far inside Postgres' bigint for any `?page=`. */
export const MAX_PAGE = 1_000_000;

/** A 1-based page number from any requested one, within 1..MAX_PAGE. */
export function pageNumber(requested: number | undefined): number {
  const page = Math.trunc(requested ?? 1);
  return Number.isFinite(page) ? Math.min(MAX_PAGE, Math.max(1, page)) : 1;
}
const STATUSES = new Set(["uploaded", "processing", "completed", "failed", "needs-review"]);
/** Group filter from `?group=` (repeatable): valid ids only, at most MAX_GROUP_FILTERS. */
export const MAX_GROUP_FILTERS = 20;
const groupFilterSchema = z
  .array(z.string())
  .transform((ids) => [
    ...new Set(ids.filter((id) => z.uuid().safeParse(id).success).map((id) => id.toLowerCase())),
  ])
  .transform((ids) => ids.slice(0, MAX_GROUP_FILTERS));

/** Drops anything malformed, so URL params can be passed straight through. */
export function cleanFilters(input: ReceiptListFilters): ReceiptFilters {
  const q = input.q?.trim().slice(0, 100);
  return {
    q: q || undefined,
    // Old free-text values in a URL still find canonical rows.
    category: input.category ? (parseCategory(input.category) ?? input.category) : undefined,
    status: input.status && STATUSES.has(input.status) ? input.status : undefined,
    from: input.from && isIsoDay(input.from) ? input.from : undefined,
    to: input.to && isIsoDay(input.to) ? input.to : undefined,
    groups: cleanGroups(input.groups),
  };
}

function cleanGroups(input: string[] | undefined) {
  const parsed = groupFilterSchema.safeParse(input ?? []);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
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
  const groups = params instanceof URLSearchParams ? params.getAll("group") : params.group;
  return {
    q: get("q"),
    category: get("category"),
    status: get("status") as ReceiptListFilters["status"],
    from: get("from"),
    to: get("to"),
    groups: groups === undefined ? undefined : Array.isArray(groups) ? groups : [groups],
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
  const page = pageNumber(filters.page);
  const clean = cleanFilters(filters);

  const scope = await requireActiveScope();
  const { rows, total } = await runtime.runPromise(
    Effect.flatMap(ReceiptRepo, (repo) =>
      repo.list(scope, clean, { limit: pageSize, offset: (page - 1) * pageSize }),
    ),
  );
  return { rows, total: total ?? 0, page, pageSize };
}

/** The newest `limit` receipts of the active workspace, without counting all of them. */
export async function listRecentReceipts(limit: number): Promise<ReceiptSummary[]> {
  const scope = await requireActiveScope();
  const { rows } = await runtime.runPromise(
    Effect.flatMap(ReceiptRepo, (repo) => repo.list(scope, {}, { limit, offset: 0, total: false })),
  );
  return rows;
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

/** Counts across the whole workspace, deduplicated per request. */
export const getReceiptCounts = cache(async (): Promise<ReceiptCounts> => {
  const scope = await requireActiveScope();
  return runtime.runPromise(Effect.flatMap(ReceiptRepo, (repo) => repo.counts(scope)));
});
