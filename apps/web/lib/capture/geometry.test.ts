import { describe, expect, it } from "vitest";
import {
  applyHomography,
  cornerAngles,
  edgeAngle,
  edgeLength,
  edgeMidpoint,
  edgeNormal,
  homography,
  isConvex,
  nearestOnEdge,
  quadArea,
  slideEdge,
  straightenedSize,
  warpQuad,
  type Pixels,
  type Point,
  type Quad,
} from "./geometry";

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

/** z of (b - a) x (c - a), in pixel proportions: 0 when c is on the line through a and b. */
const side = (a: Point, b: Point, c: Point, aspect = 1) =>
  (b.x - a.x) * aspect * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) * aspect;
/** `skewed` in normalised units, over a 100 x 120 frame. */
const skewedUnit = skewed.map((p) => ({ x: p.x / 100, y: p.y / 120 })) as Quad;

describe("slideEdge", () => {
  it("moves the top of the full frame straight down", () => {
    const q = slideEdge(square, 0, -0.1, 1);
    expect(q[0].x).toBeCloseTo(0, 12);
    expect(q[0].y).toBeCloseTo(0.1, 12);
    expect(q[1].x).toBeCloseTo(1, 12);
    expect(q[1].y).toBeCloseTo(0.1, 12);
    expect(q[2]).toEqual(square[2]);
    expect(q[3]).toEqual(square[3]);
  });

  it("slides each moved corner along its other side, keeps the edge parallel and the angles", () => {
    const before = cornerAngles(skewedUnit);
    for (let edge = 0; edge < 4; edge++) {
      const q = slideEdge(skewedUnit, edge, 0.05, 1.3);
      const [i, j] = [edge, (edge + 1) % 4];
      // Corner i stays on the line to i - 1, corner j on the line to j + 1.
      expect(side(skewedUnit[(i + 3) % 4]!, skewedUnit[i]!, q[i]!)).toBeCloseTo(0, 9);
      expect(side(skewedUnit[(j + 1) % 4]!, skewedUnit[j]!, q[j]!)).toBeCloseTo(0, 9);
      const was = {
        x: skewedUnit[j]!.x - skewedUnit[i]!.x,
        y: skewedUnit[j]!.y - skewedUnit[i]!.y,
      };
      const now = { x: q[j]!.x - q[i]!.x, y: q[j]!.y - q[i]!.y };
      expect(was.x * now.y - was.y * now.x).toBeCloseTo(0, 9);
      expect(q).not.toEqual(skewedUnit);
      cornerAngles(q).forEach((a, k) => expect(Math.abs(a - before[k]!)).toBeLessThan(1e-9));
    }
  });

  it("measures the distance in pixel proportions", () => {
    const aspect = 2;
    const q = slideEdge(skewedUnit, 1, 0.07, aspect);
    // Perpendicular distance from each new corner to the old edge's line, in a frame
    // `aspect` wide and 1 high.
    const [a, b] = [skewedUnit[1], skewedUnit[2]];
    const length = Math.hypot((b.x - a.x) * aspect, b.y - a.y);
    for (const p of [q[1], q[2]]) {
      expect(Math.abs(side(a, b, p, aspect)) / length).toBeCloseTo(0.07, 9);
    }
  });

  it("returns an equal quad for distance 0", () => {
    expect(slideEdge(skewedUnit, 2, 0, 1.5)).toEqual(skewedUnit);
  });
});

describe("edge helpers", () => {
  it("points every normal away from the quad", () => {
    for (const quad of [square, skewedUnit]) {
      // Each normal points away from the opposite edge's midpoint, which is inside.
      for (let edge = 0; edge < 4; edge++) {
        const n = edgeNormal(quad, edge, 1.4);
        expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 12);
        const mid = edgeMidpoint(quad, edge);
        const far = edgeMidpoint(quad, edge + 2);
        expect((mid.x - far.x) * 1.4 * n.x + (mid.y - far.y) * n.y).toBeGreaterThan(0);
      }
    }
    const top = edgeNormal(square, 0, 1);
    expect(top.x).toBeCloseTo(0, 12);
    expect(top.y).toBe(-1);
  });

  it("measures midpoint, on-screen length and angle", () => {
    expect(edgeMidpoint(square, 1)).toEqual({ x: 1, y: 0.5 });
    expect(edgeLength(square, 0, 300, 200)).toBe(300);
    expect(edgeLength(square, 1, 300, 200)).toBe(200);
    expect(edgeAngle(square, 0, 300, 200)).toBe(0);
    expect(edgeAngle(square, 1, 300, 200)).toBe(90);
    // The same normalised diagonal is flatter on a wider screen.
    const kite: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 },
    ];
    expect(edgeAngle(kite, 0, 100, 100)).toBeCloseTo(45, 9);
    expect(edgeAngle(kite, 0, 200, 100)).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 9);
  });

  it("finds the nearest point of an edge, kept off its ends", () => {
    expect(nearestOnEdge(square, 0, { x: 0.3, y: 0.4 }, 1)).toEqual({ x: 0.3, y: 0 });
    expect(nearestOnEdge(square, 0, { x: -2, y: 0 }, 1)).toEqual({ x: 0.1, y: 0 });
    const right = nearestOnEdge(square, 1, { x: 1.2, y: 5 }, 1);
    expect(right.x).toBe(1);
    expect(right.y).toBeCloseTo(0.9, 12);
  });
});
