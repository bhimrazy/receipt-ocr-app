/**
 * History's selection. `ids` are chosen one by one or a page at a time and survive paging and
 * sorting. `all` is every receipt the current filters match, `total` of them when chosen;
 * actions send the filters instead of ids.
 */
export type Selection = { kind: "ids"; ids: ReadonlySet<string> } | { kind: "all"; total: number };

export const NOTHING: Selection = { kind: "ids", ids: new Set() };

export function selectedCount(selection: Selection): number {
  return selection.kind === "all" ? selection.total : selection.ids.size;
}

export function isSelected(selection: Selection, id: string): boolean {
  return selection.kind === "all" || selection.ids.has(id);
}

/**
 * One row on or off. Unticking a row of "all that match" keeps the rest of this page ticked,
 * the part of "all" the person can see, rather than silently keeping hundreds of others.
 */
export function toggle(
  selection: Selection,
  id: string,
  on: boolean,
  pageIds: readonly string[],
): Selection {
  const ids = new Set(selection.kind === "all" ? pageIds : selection.ids);
  if (on) ids.add(id);
  else ids.delete(id);
  return { kind: "ids", ids };
}

/** The header checkbox: every row of this page on or off, keeping other pages' choices. */
export function togglePage(
  selection: Selection,
  pageIds: readonly string[],
  on: boolean,
): Selection {
  if (selection.kind === "all") return on ? selection : NOTHING;
  const ids = new Set(selection.ids);
  for (const id of pageIds) {
    if (on) ids.add(id);
    else ids.delete(id);
  }
  return { kind: "ids", ids };
}

export function pageState(
  selection: Selection,
  pageIds: readonly string[],
): "none" | "some" | "all" {
  if (pageIds.length === 0) return "none";
  const on = pageIds.filter((id) => isSelected(selection, id)).length;
  return on === 0 ? "none" : on === pageIds.length ? "all" : "some";
}

/** Offer "Select all {total} that match" once the whole page is ticked and there is more. */
export function canSelectAllMatching(
  selection: Selection,
  pageIds: readonly string[],
  total: number,
): boolean {
  return (
    selection.kind === "ids" &&
    total > pageIds.length &&
    selection.ids.size < total &&
    pageState(selection, pageIds) === "all"
  );
}

const count = new Intl.NumberFormat("en");

/** "1 receipt", "1,204 receipts". */
export const receiptCount = (n: number) => `${count.format(n)} ${n === 1 ? "receipt" : "receipts"}`;
