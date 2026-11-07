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

  it("swaps pixel width and height for landscape", () => {
    const [portrait, landscape] = splashDevices.filter((d) => d.w === 1024);
    expect(splashFile("dark", portrait!)).toBe("dark-2048x2732.png");
    expect(splashFile("dark", landscape!)).toBe("dark-2732x2048.png");
  });
});
