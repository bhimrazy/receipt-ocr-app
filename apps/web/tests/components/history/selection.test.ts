import { describe, expect, it } from "vitest";
import {
  canSelectAllMatching,
  isSelected,
  NOTHING,
  pageState,
  receiptCount,
  selectedCount,
  toggle,
  togglePage,
  type Selection,
} from "@/components/history/selection";

const page1 = ["a", "b", "c"];
const page2 = ["d", "e"];
const ids = (selection: Selection) =>
  selection.kind === "ids" ? [...selection.ids].sort() : selection;

describe("selection", () => {
  it("keeps rows chosen on other pages while paging", () => {
    let s = toggle(NOTHING, "a", true, page1);
    s = toggle(s, "d", true, page2);
    expect(ids(s)).toEqual(["a", "d"]);
    expect(pageState(s, page1)).toBe("some");
    expect(pageState(s, page2)).toBe("some");
    expect(selectedCount(s)).toBe(2);
  });

  it("ticks and unticks a whole page without touching other pages", () => {
    let s = toggle(NOTHING, "d", true, page2);
    s = togglePage(s, page1, true);
    expect(ids(s)).toEqual(["a", "b", "c", "d"]);
    expect(pageState(s, page1)).toBe("all");
    s = togglePage(s, page1, false);
    expect(ids(s)).toEqual(["d"]);
    expect(pageState(s, page1)).toBe("none");
  });

  it("offers all that match only once the page is fully ticked and more exist", () => {
    const full = togglePage(NOTHING, page1, true);
    expect(canSelectAllMatching(full, page1, 312)).toBe(true);
    expect(canSelectAllMatching(full, page1, 3)).toBe(false);
    expect(canSelectAllMatching(toggle(NOTHING, "a", true, page1), page1, 312)).toBe(false);
    expect(canSelectAllMatching({ kind: "all", total: 312 }, page1, 312)).toBe(false);
  });

  it("treats every row as chosen in all-that-match mode", () => {
    const all: Selection = { kind: "all", total: 312 };
    expect(selectedCount(all)).toBe(312);
    expect(isSelected(all, "zzz")).toBe(true);
    expect(pageState(all, page2)).toBe("all");
    expect(togglePage(all, page1, true)).toBe(all);
    expect(togglePage(all, page1, false)).toBe(NOTHING);
  });

  it("drops to this page's rows when one row of all-that-match is unticked", () => {
    const s = toggle({ kind: "all", total: 312 }, "b", false, page1);
    expect(ids(s)).toEqual(["a", "c"]);
  });

  it("an empty page is never fully selected", () => {
    expect(pageState(NOTHING, [])).toBe("none");
  });

  it("counts receipts in words", () => {
    expect(receiptCount(1)).toBe("1 receipt");
    expect(receiptCount(1204)).toBe("1,204 receipts");
  });
});
