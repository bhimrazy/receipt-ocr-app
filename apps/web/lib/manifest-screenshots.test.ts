import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { manifestScreenshotEntries } from "./manifest-screenshots";

const entries = manifestScreenshotEntries();

describe("manifest screenshots", () => {
  it("has a narrow one for Chrome's richer install dialog and a wide one for desktop", () => {
    expect(entries.filter((e) => e.form_factor === "narrow").length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.form_factor === "wide")).toBe(true);
  });

  it("points at committed PNGs whose pixel size matches `sizes`", () => {
    for (const entry of entries) {
      const png = readFileSync(path.join(import.meta.dirname, "../public", entry.src));
      // PNG IHDR: width and height are big-endian at bytes 16 and 20.
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, entry.src).toBe(entry.sizes);
    }
  });

  it("keeps each within Chrome's limits: 320 to 3840 px, long side at most 2.3 times the short", () => {
    for (const entry of entries) {
      const [w, h] = entry.sizes.split("x").map(Number) as [number, number];
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(320);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(2.3);
      expect(entry.form_factor === "wide").toBe(w > h);
    }
  });
});
