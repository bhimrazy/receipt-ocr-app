import { describe, expect, it } from "vitest";
import { DEFAULT_REDIRECT, safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("keeps internal paths", () => {
    expect(safeRedirect("/app/receipts")).toBe("/app/receipts");
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

  it("rejects control characters browsers strip into // (M1)", () => {
    expect(safeRedirect("/\t/evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/\n/evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/\r/evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/\u0000/evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects backslashes anywhere and encoded slashes at the start", () => {
    expect(safeRedirect("/app\\..\\evil")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/%2f/evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/%5C/evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("normalises dot segments without leaving the origin", () => {
    expect(safeRedirect("/app/../app/receipts")).toBe("/app/receipts");
    expect(safeRedirect("/..//evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("uses the first value when the param repeats", () => {
    expect(safeRedirect(["/app/receipts", "//evil.example"])).toBe("/app/receipts");
    expect(safeRedirect(["//evil.example", "/app/receipts"])).toBe(DEFAULT_REDIRECT);
  });
});
