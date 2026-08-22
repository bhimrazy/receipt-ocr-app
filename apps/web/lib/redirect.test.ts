import { describe, expect, it } from "vitest";
import { DEFAULT_REDIRECT, safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("keeps internal paths", () => {
    expect(safeRedirect("/app/history")).toBe("/app/history");
    expect(safeRedirect("/accept-invitation/abc123")).toBe("/accept-invitation/abc123");
    expect(safeRedirect("/app/upload?tab=camera")).toBe("/app/upload?tab=camera");
  });

  it("falls back when nothing is supplied", () => {
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("http://evil.example/app")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects protocol-relative URLs, which browsers treat as absolute", () => {
    expect(safeRedirect("//evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("//evil.example/app/upload")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects backslash variants some browsers normalise to //", () => {
    expect(safeRedirect("/\\evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("uses the first value when the param repeats", () => {
    expect(safeRedirect(["/app/history", "//evil.example"])).toBe("/app/history");
    expect(safeRedirect(["//evil.example", "/app/history"])).toBe(DEFAULT_REDIRECT);
  });
});
