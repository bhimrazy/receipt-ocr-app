import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splashDevices, splashFile, splashThemes, startupImages } from "@/lib/ios-splash";

describe("iOS startup images", () => {
  it("links one file per device and theme, and each file exists", () => {
    expect(startupImages).toHaveLength(splashDevices.length * splashThemes.length);
    for (const image of startupImages) {
      expect(existsSync(path.join(import.meta.dirname, "../../public", image.url))).toBe(true);
    }
  });

  it("gives every image a unique media query", () => {
    expect(new Set(startupImages.map((i) => i.media)).size).toBe(startupImages.length);
  });

  it("has iPhones in portrait and iPads in both orientations, per OS scheme", () => {
    expect(startupImages).toHaveLength((11 + 7 * 2) * 2);
    for (const image of startupImages) {
      const theme = image.url.includes("/light-") ? "light" : "dark";
      expect(image.media).toContain(`(prefers-color-scheme: ${theme})`);
      if (image.media.includes("-webkit-device-pixel-ratio: 3")) {
        expect(image.media).toContain("(orientation: portrait)");
      }
    }
    const [first] = splashDevices;
    expect(splashFile("dark", first!)).toBe("dark-1320x2868.png");
  });

  it("names a landscape iPad file wider than tall", () => {
    const pro13 = splashDevices.filter((d) => d.w === 1032 && d.h === 1376);
    expect(pro13.map((d) => splashFile("dark", d))).toEqual([
      "dark-2064x2752.png",
      "dark-2752x2064.png",
    ]);
    const landscape = startupImages.find((i) => i.url === "/splash/dark-2752x2064.png");
    expect(landscape?.media).toContain("(device-width: 1032px) and (device-height: 1376px)");
    expect(landscape?.media).toContain("(orientation: landscape)");
  });

  it("covers the iPhone Air (420 x 912 points at 3x)", () => {
    const air = splashDevices.find((d) => d.w === 420 && d.h === 912 && d.dpr === 3);
    expect(air).toBeDefined();
    expect(splashFile("light", air!)).toBe("light-1260x2736.png");
  });
});
