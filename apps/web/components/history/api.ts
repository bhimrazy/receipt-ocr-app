import type { HistoryFilters } from "@/lib/receipts";
import { filterQuery } from "./history-href";
import type { ListSort } from "./list-view";
import type { Selection } from "./selection";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

async function request(url: string, init?: RequestInit): Promise<Result<Response>> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return { ok: true, data: res };
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: json?.error ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

const postJson = (url: string, body: unknown) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export type DeleteResult = { deleted: number; skipped: number; notFound: number };

/** Deletes the selection; "all that match" sends the filters and the count the person confirmed. */
export async function deleteRequest(
  target: Selection,
  filters: HistoryFilters,
): Promise<Result<DeleteResult>> {
  const res = await postJson(
    "/api/receipts/delete",
    target.kind === "all"
      ? { filter: filterQuery(filters), expected: target.total }
      : { ids: [...target.ids] },
  );
  return res.ok ? { ok: true, data: (await res.data.json()) as DeleteResult } : res;
}

/** The ids "all that match" stands for, up to the server's limit. */
export async function matchingIdsRequest(
  filters: HistoryFilters,
): Promise<Result<{ ids: string[]; truncated: boolean }>> {
  const query = filterQuery(filters);
  const res = await request(query ? `/api/receipts/ids?${query}` : "/api/receipts/ids");
  return res.ok ? { ok: true, data: await res.data.json() } : res;
}

/** The selected receipts' CSV, saved through a temporary link. */
export async function exportSelection(
  ids: readonly string[],
  sort: ListSort | undefined,
): Promise<string | void> {
  const res = await postJson("/api/receipts/export", { ids, ...(sort ? { sort } : {}) });
  if (!res.ok) return res.error;
  const blob = await res.data.blob();
  const name = /filename="([^"]+)"/.exec(res.data.headers.get("content-disposition") ?? "")?.[1];
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name ?? "receipts.csv";
  link.click();
  URL.revokeObjectURL(url);
}
