import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime", () => ({ runtime: {} }));
vi.mock("@/lib/session", () => ({ requireActiveScope: async () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { viewerTimeZone } from "@/lib/spend";

describe("viewerTimeZone", () => {
  it("uses a real IANA zone from the cookie", () => {
    expect(viewerTimeZone("Asia/Kathmandu")).toBe("Asia/Kathmandu");
  });

  it("falls back to UTC when the cookie is missing, junk or oversized", () => {
    expect(viewerTimeZone(undefined)).toBe("UTC");
    expect(viewerTimeZone("Mars/Olympus")).toBe("UTC");
    expect(viewerTimeZone("x".repeat(500))).toBe("UTC");
    // Offsets and abbreviations Intl accepts, but not an Area/Location name.
    for (const odd of ["+05:45", "-08:00", "EST", "GMT+5", "Asia/", "/Asia", "Asia//Tokyo"]) {
      expect(viewerTimeZone(odd)).toBe("UTC");
    }
    expect(viewerTimeZone("UTC")).toBe("UTC");
    expect(viewerTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
  });
});
