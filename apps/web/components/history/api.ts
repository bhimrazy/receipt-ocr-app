import { apiRequest, OFFLINE_MESSAGE } from "@/lib/api-request";
import type { HistoryFilters } from "@/lib/receipts";
import { filterQuery } from "./history-href";
import type { ListSort } from "./list-view";
import type { Selection } from "./selection";

export type DeleteResult = { deleted: number; skipped: number; notFound: number };

/**
 * Deletes the selection; "all that match" sends the filters and the count the person confirmed.
 * Every request names the workspace the selection was made in.
 */
export const deleteRequest = (organizationId: string, target: Selection, filters: HistoryFilters) =>
  apiRequest<DeleteResult>(
    "/api/receipts/delete",
    "POST",
    target.kind === "all"
      ? { organizationId, filter: filterQuery(filters), expected: target.total }
      : { organizationId, ids: [...target.ids] },
  );

/** The ids "all that match" stands for, up to the server's limit. */
export function matchingIdsRequest(organizationId: string, filters: HistoryFilters) {
  const query = filterQuery(filters);
  const org = new URLSearchParams({ org: organizationId });
  return apiRequest<{ ids: string[]; truncated: boolean }>(
    `/api/receipts/ids?${org}${query ? `&${query}` : ""}`,
    "GET",
  );
}

/** Saves the selected receipts' CSV through a temporary link; returns an error to show. */
export async function exportSelection(
  organizationId: string,
  ids: readonly string[],
  sort: ListSort | undefined,
): Promise<string | void> {
  let res: Response;
  try {
    res = await fetch("/api/receipts/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, ids, ...(sort ? { sort } : {}) }),
    });
  } catch {
    return OFFLINE_MESSAGE;
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return json?.error ?? "Couldn't export these receipts. Try again.";
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name ?? "receipts.csv";
  link.click();
  URL.revokeObjectURL(url);
}
