/** History's page size and sort, as they appear in the URL (`?size=`, `?sort=`, `?dir=`). */

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const SORT_KEYS = ["uploaded", "date", "total", "merchant"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type ListSort = { by: SortKey; dir: SortDir };

/** Without `sort`, the list is newest upload first; that order is never written as a `sort`. */
export type ListView = { size: number; sort?: ListSort };

/** Newest added and date and largest total first; merchants A to Z. */
const FIRST_DIR: Record<SortKey, SortDir> = {
  uploaded: "desc",
  date: "desc",
  total: "desc",
  merchant: "asc",
};

const isDefault = (sort: ListSort) => sort.by === "uploaded" && sort.dir === "desc";

/** The orders the Sort menu offers, every width: each key in both directions. */
export const SORT_OPTIONS: { sort: ListSort; label: string }[] = [
  { sort: { by: "uploaded", dir: "desc" }, label: "Added, newest first" },
  { sort: { by: "uploaded", dir: "asc" }, label: "Added, oldest first" },
  { sort: { by: "date", dir: "desc" }, label: "Receipt date, newest first" },
  { sort: { by: "date", dir: "asc" }, label: "Receipt date, oldest first" },
  { sort: { by: "total", dir: "desc" }, label: "Total, highest first" },
  { sort: { by: "total", dir: "asc" }, label: "Total, lowest first" },
  { sort: { by: "merchant", dir: "asc" }, label: "Merchant, A to Z" },
  { sort: { by: "merchant", dir: "desc" }, label: "Merchant, Z to A" },
];

/** The Sort menu's value for a view: `uploaded:desc` without a sort. */
export const sortValue = (sort: ListSort | undefined) =>
  sort ? `${sort.by}:${sort.dir}` : "uploaded:desc";

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
  const sort: ListSort | undefined = key
    ? { by: key, dir: dir === "asc" || dir === "desc" ? dir : FIRST_DIR[key] }
    : undefined;
  return {
    size: PAGE_SIZES.find((s) => s === size) ?? DEFAULT_PAGE_SIZE,
    sort: sort && !isDefault(sort) ? sort : undefined,
  };
}

export function setViewParams(params: URLSearchParams, view: ListView) {
  params.delete("size");
  params.delete("sort");
  params.delete("dir");
  if (view.size !== DEFAULT_PAGE_SIZE) params.set("size", String(view.size));
  if (view.sort && !isDefault(view.sort)) {
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
