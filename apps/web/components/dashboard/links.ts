import type { SpendSearch } from "@receipt-ocr/core";
import { historyHref } from "@/components/history/history-href";

/** Spending with the dashboard params; `undefined` in the patch drops a param. */
export function spendingHref(search: SpendSearch, patch: Partial<SpendSearch> = {}) {
  const next = { ...search, ...patch };
  const params = new URLSearchParams();
  for (const key of ["range", "from", "to", "compare", "currency"] as const) {
    const value = next[key];
    if (value) params.set(key, value);
  }
  return params.size ? `/app/spending?${params}` : "/app/spending";
}

/**
 * History filtered to a slice of the dashboard. History filters on the
 * receipt date, so receipts placed by upload date don't appear there, and it
 * has no currency filter yet: the list shows every currency for the slice.
 */
export function sliceHref(slice: {
  from: string;
  to: string;
  category?: string | null;
  merchant?: string;
}) {
  return historyHref({
    from: slice.from,
    to: slice.to,
    category: slice.category ?? undefined,
    q: slice.merchant,
  });
}
