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

  it("is iPhone and portrait, with one image per device for each OS scheme", () => {
    expect(startupImages).toHaveLength(22);
    for (const image of startupImages) {
      expect(image.media).toContain("(orientation: portrait)");
      const theme = image.url.includes("/light-") ? "light" : "dark";
      expect(image.media).toContain(`(prefers-color-scheme: ${theme})`);
    }
    const [first] = splashDevices;
    expect(splashFile("dark", first!)).toBe("dark-1320x2868.png");
  });

  it("covers the iPhone Air (420 x 912 points at 3x)", () => {
    const air = splashDevices.find((d) => d.w === 420 && d.h === 912 && d.dpr === 3);
    expect(air).toBeDefined();
    expect(splashFile("light", air!)).toBe("light-1260x2736.png");
  });
});
