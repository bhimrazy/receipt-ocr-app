import type { HistoryFilters } from "@/lib/receipts";

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

/** A History URL for these filters; page 1 is left out so it matches the unpaged URL. */
export function historyHref(filters: HistoryFilters, page = 1, selecting = false) {
  const params = filterParams(filters);
  if (selecting) params.set("select", "1"); // SELECT_PARAM
  if (page > 1) params.set("page", String(page));
  return params.size ? `/app/history?${params}` : "/app/history";
}

export function exportHref(filters: HistoryFilters) {
  const params = filterParams(filters);
  return params.size ? `/api/receipts/export?${params}` : "/api/receipts/export";
}
