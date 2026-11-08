import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runtime", () => ({ runtime: {} }));
vi.mock("./session", () => ({}));

const { cleanFilters, filtersFromSearchParams, MAX_GROUP_FILTERS } = await import("./receipts");
const { exportHref, historyHref, isFiltered } = await import("@/components/history/history-href");

const A = "6f1c1d1e-7a3b-4c2d-9e8f-0a1b2c3d4e5f";
const B = "0b6a3c1e-2d4f-4a5b-8c7d-9e0f1a2b3c4d";

describe("date filter params", () => {
  it("keeps real days only, since the column is a date", () => {
    expect(cleanFilters({ from: "2026-01-31", to: "2026-02-30" })).toMatchObject({
      from: "2026-01-31",
      to: undefined,
    });
    expect(cleanFilters({ from: "31/01/2026" }).from).toBeUndefined();
  });
});

describe("group filter params", () => {
  it("reads repeated ?group= from the URL and from Next's searchParams object", () => {
    expect(filtersFromSearchParams(new URLSearchParams(`group=${A}&group=${B}`)).groups).toEqual([
      A,
      B,
    ]);
    expect(filtersFromSearchParams({ group: A }).groups).toEqual([A]);
    expect(filtersFromSearchParams({ group: [A, B] }).groups).toEqual([A, B]);
    expect(filtersFromSearchParams({}).groups).toBeUndefined();
  });

  it("keeps valid ids only, deduplicated and capped", () => {
    expect(cleanFilters({ groups: ["nope", A, A.toUpperCase(), "'; drop table"] }).groups).toEqual([
      A,
    ]);
    expect(cleanFilters({ groups: ["nope"] }).groups).toBeUndefined();
    const many = Array.from({ length: 30 }, () => crypto.randomUUID());
    expect(cleanFilters({ groups: many }).groups).toHaveLength(MAX_GROUP_FILTERS);
  });

  it("carries groups into History, pagination and export links", () => {
    const filters = { status: "failed" as const, groups: [A, B] };
    expect(isFiltered({ groups: [A] })).toBe(true);
    expect(historyHref(filters, 2)).toBe(`/app/history?status=failed&group=${A}&group=${B}&page=2`);
    expect(exportHref(filters)).toBe(`/api/receipts/export?status=failed&group=${A}&group=${B}`);
  });
});
