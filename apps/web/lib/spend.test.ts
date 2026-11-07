import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runtime", () => ({ runtime: {} }));
vi.mock("./session", () => ({ requireActiveScope: async () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { viewerTimeZone } from "./spend";

describe("viewerTimeZone", () => {
  it("uses a real IANA zone from the cookie", () => {
    expect(viewerTimeZone("Asia/Kathmandu")).toBe("Asia/Kathmandu");
  });

  it("falls back to UTC when the cookie is missing, junk or oversized", () => {
    expect(viewerTimeZone(undefined)).toBe("UTC");
    expect(viewerTimeZone("Mars/Olympus")).toBe("UTC");
    expect(viewerTimeZone("x".repeat(500))).toBe("UTC");
  });
});
