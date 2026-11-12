/** History's page size and sort, as they appear in the URL (`?size=`, `?sort=`, `?dir=`). */

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const SORT_KEYS = ["date", "total", "merchant"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type ListSort = { by: SortKey; dir: SortDir };

/** Without `sort`, the list is newest upload first. */
export type ListView = { size: number; sort?: ListSort };

/** Newest date and largest total first; merchants A to Z. */
const FIRST_DIR: Record<SortKey, SortDir> = { date: "desc", total: "desc", merchant: "asc" };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function first(params: Params, key: string) {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value) ?? undefined;
}

/** Anything not offered in the UI falls back to the default, so a URL can't ask for 10,000 rows. */
export function viewFromParams(params: Params): ListView {
  const size = Number(first(params, "size"));
  const by = first(params, "sort");
  const dir = first(params, "dir");
  const key = SORT_KEYS.find((k) => k === by);
  return {
    size: PAGE_SIZES.find((s) => s === size) ?? DEFAULT_PAGE_SIZE,
    sort: key
      ? { by: key, dir: dir === "asc" || dir === "desc" ? dir : FIRST_DIR[key] }
      : undefined,
  };
}

export function setViewParams(params: URLSearchParams, view: ListView) {
  params.delete("size");
  params.delete("sort");
  params.delete("dir");
  if (view.size !== DEFAULT_PAGE_SIZE) params.set("size", String(view.size));
  if (view.sort) {
    params.set("sort", view.sort.by);
    params.set("dir", view.sort.dir);
  }
}

/** A header click: the other direction on the sorted column, else that column's first direction. */
export function nextSort(current: ListSort | undefined, by: SortKey): ListSort {
  if (current?.by === by) return { by, dir: current.dir === "asc" ? "desc" : "asc" };
  return { by, dir: FIRST_DIR[by] };
}

const count = new Intl.NumberFormat("en");

/** "26–50 of 312": the rows on this page, by position in the whole filtered list. */
export function rangeText(page: number, pageSize: number, total: number) {
  if (total === 0) return "0 of 0";
  const start = Math.min(total, (page - 1) * pageSize + 1);
  const end = Math.min(total, page * pageSize);
  return `${count.format(start)}–${count.format(end)} of ${count.format(total)}`;
}
