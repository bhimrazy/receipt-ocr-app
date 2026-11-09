import { describe, expect, it } from "vitest";
import { loadsAnotherPage } from "./use-online";

const here = "https://app.test/app/history?status=done";

describe("loadsAnotherPage", () => {
  it("is true for another page or another query on this site", () => {
    expect(loadsAnotherPage("/app/settings", here)).toBe(true);
    expect(loadsAnotherPage("/app/history?status=failed", here)).toBe(true);
    expect(loadsAnotherPage("https://app.test/app", here)).toBe(true);
  });
  it("is false for a jump within this page", () => {
    expect(loadsAnotherPage("#receipts", here)).toBe(false);
    expect(loadsAnotherPage("/app/history?status=done#top", here)).toBe(false);
  });
  it("is false for other sites, downloads and new windows", () => {
    expect(loadsAnotherPage("https://example.com/", here)).toBe(false);
    expect(loadsAnotherPage("mailto:help@example.com", here)).toBe(false);
    expect(loadsAnotherPage("/api/export.csv", here, { download: true })).toBe(false);
    expect(loadsAnotherPage("/terms", here, { target: "_blank" })).toBe(false);
    expect(loadsAnotherPage("/terms", here, { target: "_self" })).toBe(true);
  });
});
