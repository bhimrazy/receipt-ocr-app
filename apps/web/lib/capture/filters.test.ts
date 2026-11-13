import type { Pixels } from "@receipt-ocr/vision";
import { describe, expect, it } from "vitest";
import {
  applyFilter,
  blackAndWhite,
  defaultFilter,
  enhance,
  greyscale,
  percentile,
} from "./filters";

function image(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...fill(x, y), 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

const at = (img: Pixels, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

describe("percentile", () => {
  it("finds the value under which a fraction of pixels fall", () => {
    const hist = new Uint32Array(256);
    hist[10] = 50;
    hist[200] = 50;
    expect(percentile(hist, 100, 0.01)).toBe(10);
    expect(percentile(hist, 100, 0.99)).toBe(200);
  });
});

describe("enhance", () => {
  it("stretches a dull grey receipt so the paper turns white and the ink black", () => {
    // Paper at 170, ink at 90: a dim photo.
    const img = image(100, 100, (x) => (x % 10 === 0 ? [90, 90, 90] : [170, 170, 170]));
    enhance(img);
    expect(at(img, 0, 0)[0]).toBeLessThan(10);
    expect(at(img, 5, 5)[0]).toBeGreaterThan(245);
  });

  it("pulls yellowed paper toward white", () => {
    const img = image(100, 100, (x) => (x % 10 === 0 ? [60, 55, 40] : [230, 215, 170]));
    enhance(img);
    const [r, g, b] = at(img, 5, 5) as [number, number, number];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40);
    expect(b).toBeGreaterThan(200);
  });

  it("leaves a flat image alone", () => {
    const img = image(10, 10, () => [120, 120, 120]);
    enhance(img);
    expect(at(img, 3, 3)).toEqual([120, 120, 120]);
  });
});

describe("greyscale", () => {
  it("uses luma weights", () => {
    const img = greyscale(image(1, 1, () => [255, 0, 0]));
    expect(at(img, 0, 0)).toEqual([76, 76, 76]);
  });
});

describe("blackAndWhite", () => {
  it("keeps text on a shading gradient, where a global threshold would lose half the page", () => {
    // Paper fades from 230 (left) to 110 (right); text strokes sit 50 below the paper.
    const width = 320;
    const height = 120;
    const paper = (x: number) => 230 - (120 * x) / width;
    const ink = (x: number, y: number) => y % 20 >= 8 && y % 20 < 11 && x % 8 < 5;
    const img = image(width, height, (x, y) => {
      const v = paper(x) - (ink(x, y) ? 50 : 0);
      return [v, v, v];
    });
    blackAndWhite(img);
    let paperRight = 0;
    let inkRight = 0;
    let paperCount = 0;
    let inkCount = 0;
    for (let y = 20; y < height - 20; y++) {
      for (let x = width - 60; x < width - 20; x++) {
        if (ink(x, y)) {
          inkCount++;
          if (at(img, x, y)[0] === 0) inkRight++;
        } else {
          paperCount++;
          if (at(img, x, y)[0] === 255) paperRight++;
        }
      }
    }
    // On the darkest part of the page, paper still reads white and text black.
    expect(paperRight / paperCount).toBeGreaterThan(0.95);
    expect(inkRight / inkCount).toBeGreaterThan(0.9);
    expect(new Set(img.data.filter((_, i) => i % 4 === 0))).toEqual(new Set([0, 255]));
  });

  it("is linear: a 3 MP image finishes quickly", () => {
    const img = image(2000, 1500, (x, y) => [(x + y) % 256, (x + y) % 256, (x + y) % 256]);
    const start = performance.now();
    blackAndWhite(img);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe("filter choice", () => {
  it("defaults to Enhance when a document was found, Original otherwise, unless one was picked", () => {
    expect(defaultFilter(null, true)).toBe("enhance");
    expect(defaultFilter(null, false)).toBe("original");
    expect(defaultFilter("bw", false)).toBe("bw");
  });

  it("leaves Original untouched", () => {
    const img = image(2, 2, () => [10, 20, 30]);
    expect(Array.from(applyFilter(img, "original").data)).toEqual(Array.from(img.data));
  });
});
