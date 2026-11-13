import type { HistoryFilters } from "@/lib/receipts";
import { DEFAULT_PAGE_SIZE, setViewParams, type ListView } from "./list-view";

const FILTER_KEYS = ["q", "category", "status", "from", "to"] as const;

export function isFiltered(filters: HistoryFilters) {
  return FILTER_KEYS.some((key) => filters[key]) || Boolean(filters.groups?.length); // groups
}

function filterParams(filters: HistoryFilters) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  for (const id of filters.groups ?? []) params.append("group", id); // groups
  return params;
}

/** The filters alone as a query string, for an action on "all that match". */
export const filterQuery = (filters: HistoryFilters) => filterParams(filters).toString();

/** A History URL for these filters and view; page 1 is left out so it matches the unpaged URL. */
export function historyHref(
  filters: HistoryFilters,
  page = 1,
  view: ListView = { size: DEFAULT_PAGE_SIZE },
) {
  const params = filterParams(filters);
  setViewParams(params, view);
  if (page > 1) params.set("page", String(page));
  return params.size ? `/app/receipts?${params}` : "/app/receipts";
}

/** The CSV of every receipt matching the filters, in the list's order. */
export function exportHref(filters: HistoryFilters, view?: ListView) {
  const params = filterParams(filters);
  if (view?.sort) setViewParams(params, { size: DEFAULT_PAGE_SIZE, sort: view.sort });
  return params.size ? `/api/receipts/export?${params}` : "/api/receipts/export";
}
