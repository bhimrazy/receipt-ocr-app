import { describe, expect, it } from "vitest";
import { historyHref, exportHref } from "./history-href";
import { nextSort, rangeText, viewFromParams } from "./list-view";

describe("rangeText", () => {
  it("names the rows on the page within the whole list", () => {
    expect(rangeText(1, 25, 312)).toBe("1–25 of 312");
    expect(rangeText(2, 25, 312)).toBe("26–50 of 312");
    expect(rangeText(13, 25, 312)).toBe("301–312 of 312");
    expect(rangeText(1, 100, 7)).toBe("1–7 of 7");
    expect(rangeText(3, 50, 1204)).toBe("101–150 of 1,204");
  });

  it("stays sensible for an empty list or a page past the end", () => {
    expect(rangeText(1, 25, 0)).toBe("0 of 0");
    expect(rangeText(9, 25, 30)).toBe("30–30 of 30");
  });
});

describe("list view params", () => {
  it("reads page size and sort, falling back to the defaults", () => {
    expect(viewFromParams(new URLSearchParams("size=50&sort=total&dir=asc"))).toEqual({
      size: 50,
      sort: { by: "total", dir: "asc" },
    });
    expect(viewFromParams({ size: "10000", sort: "rawJson" })).toEqual({ size: 25 });
    expect(viewFromParams({ sort: "merchant" })).toEqual({
      size: 25,
      sort: { by: "merchant", dir: "asc" },
    });
    expect(viewFromParams({ sort: "date", dir: "sideways" }).sort).toEqual({
      by: "date",
      dir: "desc",
    });
  });

  it("flips the sorted column and starts others in their natural direction", () => {
    expect(nextSort(undefined, "date")).toEqual({ by: "date", dir: "desc" });
    expect(nextSort({ by: "date", dir: "desc" }, "date")).toEqual({ by: "date", dir: "asc" });
    expect(nextSort({ by: "date", dir: "asc" }, "merchant")).toEqual({
      by: "merchant",
      dir: "asc",
    });
  });

  it("keeps size and sort in Receipts links but leaves defaults out", () => {
    const view = { size: 50, sort: { by: "total" as const, dir: "desc" as const } };
    expect(historyHref({ status: "failed" }, 2, view)).toBe(
      "/app/receipts?status=failed&size=50&sort=total&dir=desc&page=2",
    );
    expect(historyHref({}, 1, { size: 25 })).toBe("/app/receipts");
    expect(exportHref({ q: "cafe" }, view)).toBe("/api/receipts/export?q=cafe&sort=total&dir=desc");
  });
});
