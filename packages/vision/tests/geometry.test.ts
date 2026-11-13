import { describe, expect, it } from "vitest";
import {
  applyHomography,
  cornerAngles,
  homography,
  isConvex,
  quadArea,
  straightenedSize,
  warpQuad,
  type Pixels,
  type Quad,
} from "../src/geometry";

const square: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const skewed: Quad = [
  { x: 12, y: 8 },
  { x: 90, y: 20 },
  { x: 80, y: 110 },
  { x: 5, y: 95 },
];

describe("homography", () => {
  it("maps each source corner onto its target", () => {
    const h = homography(square, skewed)!;
    square.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(skewed[i]!.x, 6);
      expect(q.y).toBeCloseTo(skewed[i]!.y, 6);
    });
  });

  it("is the identity for identical quads", () => {
    const h = homography(skewed, skewed)!;
    const p = applyHomography(h, { x: 40, y: 50 });
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });

  it("keeps straight lines straight (the midpoint of an edge stays on the edge)", () => {
    const h = homography(square, skewed)!;
    const mid = applyHomography(h, { x: 0.5, y: 0 });
    const [a, b] = [skewed[0], skewed[1]];
    const crossZ = (b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x);
    expect(Math.abs(crossZ)).toBeLessThan(1e-6);
  });

  it("returns null when three corners are on one line", () => {
    const flat: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(homography(square, flat)).toBeNull();
  });
});

describe("quad checks", () => {
  it("measures area and angles", () => {
    expect(quadArea(square)).toBe(1);
    expect(cornerAngles(square).map(Math.round)).toEqual([90, 90, 90, 90]);
  });

  it("rejects a bow-tie as not convex", () => {
    expect(isConvex(square)).toBe(true);
    expect(isConvex([square[0], square[2], square[1], square[3]])).toBe(false);
  });

  it("sizes the output by the longer opposite edges, within a pixel budget", () => {
    expect(straightenedSize(skewed, 1e9)).toEqual({ width: 79, height: 91 });
    const capped = straightenedSize(
      [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 3000 },
        { x: 0, y: 3000 },
      ],
      3_000_000,
    );
    expect(capped.width * capped.height).toBeLessThanOrEqual(3_000_000 * 1.001);
    expect(capped.width / capped.height).toBeCloseTo(4 / 3, 2);
  });
});

function checkerboard(width: number, height: number, cell: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0;
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const px = (img: Pixels, x: number, y: number) => img.data[(y * img.width + x) * 4]!;

describe("warpQuad", () => {
  it("copies the image unchanged when the quad is the whole frame", () => {
    const src = checkerboard(16, 12, 4);
    const out = warpQuad(
      src,
      [
        { x: 0, y: 0 },
        { x: 16, y: 0 },
        { x: 16, y: 12 },
        { x: 0, y: 12 },
      ],
      16,
      12,
    );
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it("crops a sub-rectangle", () => {
    const src = checkerboard(40, 40, 10);
    // The cell from (10,0) to (20,10) is white; take exactly it.
    const out = warpQuad(
      src,
      [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ],
      10,
      10,
    );
    expect(out.data.every((v) => v === 255)).toBe(true);
  });

  it("straightens a rotated square back to its original pattern", () => {
    // Draw a 40x40 two-tone square (left half black) rotated 30 degrees into a 100x100 frame.
    const size = 100;
    const angle = Math.PI / 6;
    const c = { x: 50, y: 50 };
    const rot = (x: number, y: number) => ({
      x: c.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: c.y + x * Math.sin(angle) + y * Math.cos(angle),
    });
    const data = new Uint8ClampedArray(size * size * 4).fill(128);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Inverse rotate the pixel centre into the square's frame.
        const dx = x + 0.5 - c.x;
        const dy = y + 0.5 - c.y;
        const u = dx * Math.cos(angle) + dy * Math.sin(angle);
        const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
        if (Math.abs(u) <= 20 && Math.abs(v) <= 20) {
          const value = u < 0 ? 0 : 255;
          data.set([value, value, value, 255], (y * size + x) * 4);
        }
      }
    }
    const quad: Quad = [rot(-20, -20), rot(20, -20), rot(20, 20), rot(-20, 20)];
    const out = warpQuad({ data, width: size, height: size }, quad, 40, 40);
    // Away from the seam and the edges, the halves are clean.
    expect(px(out, 8, 20)).toBeLessThan(40);
    expect(px(out, 32, 20)).toBeGreaterThan(215);
    expect(px(out, 8, 5)).toBeLessThan(40);
    expect(px(out, 32, 35)).toBeGreaterThan(215);
  });
});
