import { cornerAngles, type Point, type Quad } from "@receipt-ocr/vision";
import { describe, expect, it } from "vitest";
import { edgeAngle, edgeLength, edgeMidpoint, edgeNormal, nearestOnEdge, slideEdge } from "./edges";

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
