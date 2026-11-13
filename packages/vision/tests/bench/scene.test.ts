import { describe, expect, it } from "vitest";
import { CATEGORIES, SEED_SETS, renderCategoryScene } from "../../bench/categories";
import { hash3, mulberry32, valueNoise } from "../../bench/rng";
import { HEIGHT, MASK_HEIGHT, MASK_WIDTH, WIDTH } from "../../bench/scene";
import { quadArea } from "../../src/geometry";

const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);

describe("rng", () => {
  it("repeats for a seed and differs between seeds", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });

  it("keeps hashes and noise in [0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      for (const v of [hash3(i, -i, 3), valueNoise(i * 0.37, i * 0.11, 5)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe("categories", () => {
  it("has unique ids and the plan's sixteen categories", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(16);
    expect(CATEGORIES.reduce((s, c) => s + c.weight, 0)).toBe(101);
  });

  it("keeps the tuning and gate seeds apart", () => {
    expect(Math.abs(SEED_SETS.gate - SEED_SETS.tune)).toBeGreaterThanOrEqual(1000);
  });
});

describe("renderCategoryScene", () => {
  it("is a pure function of category and seed", () => {
    const a = renderCategoryScene(1, 5001);
    const b = renderCategoryScene(1, 5001);
    expect(Buffer.from(a.pixels.data).equals(Buffer.from(b.pixels.data))).toBe(true);
    expect(a.truth.quad).toEqual(b.truth.quad);
    const c = renderCategoryScene(1, 5002);
    expect(Buffer.from(a.pixels.data).equals(Buffer.from(c.pixels.data))).toBe(false);
  });

  it.each(CATEGORIES.map((c, i) => [c.id, i] as const))(
    "renders %s with consistent ground truth",
    (_id, index) => {
      for (const seed of [5000, 5001]) {
        const { pixels, truth } = renderCategoryScene(index, seed);
        expect(pixels.data.length).toBe(pixels.width * pixels.height * 4);
        expect([WIDTH, MASK_WIDTH]).toContain(pixels.width);
        expect(truth.paper.length).toBe(MASK_WIDTH * MASK_HEIGHT);
        expect(sum(truth.paper)).toBeGreaterThan(0);
        for (let i = 0; i < truth.print.length; i++)
          if (truth.print[i] && !truth.paper[i]) throw new Error("print outside paper");
        if (truth.kind === "paper" && truth.cornersInFrame) {
          // The mask follows bowed sides, so it only roughly matches the quad.
          const quadPixels = quadArea(
            truth.quad.map((p) => ({
              x: p.x * MASK_WIDTH,
              y: p.y * MASK_HEIGHT,
            })) as typeof truth.quad,
          );
          expect(sum(truth.paper) / quadPixels).toBeGreaterThan(0.9);
          expect(sum(truth.paper) / quadPixels).toBeLessThan(1.1);
        }
      }
    },
  );

  it("clips the paper in the partial category and keeps it fully inside elsewhere", () => {
    const partial = CATEGORIES.findIndex((c) => c.id === "partial");
    const table = CATEGORIES.findIndex((c) => c.id === "table");
    for (const seed of [5000, 5001, 5002]) {
      expect(renderCategoryScene(partial, seed).truth.cornersInFrame).toBe(false);
      expect(renderCategoryScene(table, seed).truth.cornersInFrame).toBe(true);
    }
  });

  it("removes covered print from the print mask but keeps the paper under fingers", () => {
    const hand = CATEGORIES.findIndex((c) => c.id === "hand");
    const { truth } = renderCategoryScene(hand, 5000);
    const insetQuadArea =
      quadArea(
        truth.quad.map((p) => ({ x: p.x * MASK_WIDTH, y: p.y * MASK_HEIGHT })) as typeof truth.quad,
      ) * 0.81;
    expect(sum(truth.print)).toBeLessThan(insetQuadArea);
    expect(sum(truth.print)).toBeGreaterThan(insetQuadArea * 0.7);
  });

  it("marks screenshots as digital with the whole frame as paper", () => {
    const digital = CATEGORIES.findIndex((c) => c.id === "digital");
    const { truth } = renderCategoryScene(digital, 5000);
    expect(truth.kind).toBe("digital");
    expect(sum(truth.paper)).toBe(MASK_WIDTH * MASK_HEIGHT);
    expect(HEIGHT).toBe(MASK_HEIGHT * 2);
  });
});
