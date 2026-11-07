import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splashDevices, splashFile, splashThemes, startupImages } from "./ios-splash";

describe("iOS startup images", () => {
  it("links one file per device and theme, and each file exists", () => {
    expect(startupImages).toHaveLength(splashDevices.length * splashThemes.length);
    for (const image of startupImages) {
      expect(existsSync(path.join(import.meta.dirname, "../public", image.url))).toBe(true);
    }
  });

  it("gives every image a unique media query", () => {
    expect(new Set(startupImages.map((i) => i.media)).size).toBe(startupImages.length);
  });

  it("is iPhone, portrait and dark only", () => {
    expect(startupImages).toHaveLength(10);
    for (const image of startupImages) {
      expect(image.media).toContain("(orientation: portrait)");
      expect(image.media).not.toContain("prefers-color-scheme");
    }
    const [first] = splashDevices;
    expect(splashFile("dark", first!)).toBe("dark-1320x2868.png");
  });
});
