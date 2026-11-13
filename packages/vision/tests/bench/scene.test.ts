import { describe, expect, it } from "vitest";
import { CATEGORIES, SEED_SETS, renderCategoryScene, seedsFor } from "../../bench/categories";
import { fingerprintScene } from "../../bench/fingerprint";
import { hash3, mulberry32, valueNoise } from "../../bench/rng";
import { MASK_HEIGHT, MASK_WIDTH, WIDTH, pointSample } from "../../bench/scene";
import { quadArea, type Quad } from "../../src/geometry";

const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);
const maskQuad = (q: Quad) =>
  quadArea(q.map((p) => ({ x: p.x * MASK_WIDTH, y: p.y * MASK_HEIGHT })) as Quad);

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

describe("seed sets", () => {
  it("has the plan's sixteen categories", () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(16);
    expect(CATEGORIES.reduce((s, c) => s + c.weight, 0)).toBe(101);
  });

  it("never hands out the same seed from two sets, even at the caps", () => {
    const seen = new Map<number, string>();
    for (const set of Object.keys(SEED_SETS) as (keyof typeof SEED_SETS)[]) {
      for (const seed of seedsFor(set, SEED_SETS[set].max)) {
        expect(seen.get(seed), `seed ${seed}`).toBeUndefined();
        seen.set(seed, set);
      }
    }
  });

  it("refuses a count that would run past the pool", () => {
    expect(() => seedsFor("tune", SEED_SETS.tune.max + 1)).toThrow();
    expect(() => seedsFor("gate", 0)).toThrow();
    expect(seedsFor("holdout", 3)).toEqual([9000, 9001, 9002]);
  });
});

describe("renderCategoryScene", () => {
  it("is a pure function of category id and seed", () => {
    const a = renderCategoryScene("hand", 5001);
    const b = renderCategoryScene("hand", 5001);
    expect(Buffer.from(a.pixels.data).equals(Buffer.from(b.pixels.data))).toBe(true);
    expect(fingerprintScene(a)).toBe(fingerprintScene(b));
    const c = renderCategoryScene("hand", 5002);
    expect(fingerprintScene(a)).not.toBe(fingerprintScene(c));
  });

  it("gives each category its own scenes for the same seed", () => {
    expect(fingerprintScene(renderCategoryScene("table", 5000))).not.toBe(
      fingerprintScene(renderCategoryScene("a4", 5000)),
    );
  });

  it.each(CATEGORIES.map((c) => c.id))("renders %s with consistent ground truth", (id) => {
    for (const seed of [5000, 5001]) {
      const { pixels, truth } = renderCategoryScene(id, seed);
      expect(pixels.data.length).toBe(pixels.width * pixels.height * 4);
      expect([WIDTH, MASK_WIDTH]).toContain(pixels.width);
      expect(truth.paper.length).toBe(MASK_WIDTH * MASK_HEIGHT);
      expect(sum(truth.paper)).toBeGreaterThan(0);
      for (let i = 0; i < truth.print.length; i++) {
        if (truth.print[i] && !truth.paper[i]) throw new Error("print outside paper");
      }
      if (truth.kind === "paper" && truth.cornersInFrame) {
        // The mask follows bowed sides, so it only roughly matches the quad.
        const ratio = sum(truth.paper) / maskQuad(truth.quad);
        expect(ratio).toBeGreaterThan(0.9);
        expect(ratio).toBeLessThan(1.1);
      }
      expect(truth.expected).toBe(truth.kind === "digital" ? "none" : "crop");
    }
  });

  it("rotates through every variant of a category within a few consecutive seeds", () => {
    const variants = (id: string, n: number) =>
      new Set(seedsFor("gate", n).map((seed) => renderCategoryScene(id, seed).truth.variant));
    expect(variants("digital", 8).size).toBe(8);
    expect(variants("several", 4)).toEqual(new Set(["separate", "close", "under", "over"]));
    expect(variants("patterned", 5).has("dashboard")).toBe(true);
    expect(variants("white", 4)).toEqual(
      new Set(["white desk", "bed sheet", "light wood", "darker receipt"]),
    );
  });

  it("clips the paper in the partial category and keeps it inside elsewhere", () => {
    for (const seed of [5000, 5001, 5002]) {
      const partial = renderCategoryScene("partial", seed).truth;
      expect(partial.cornersInFrame).toBe(false);
      expect(partial.sides).toContain("off-frame");
      const table = renderCategoryScene("table", seed).truth;
      expect(table.cornersInFrame).toBe(true);
      expect(table.sides).toEqual(["visible", "visible", "visible", "visible"]);
    }
  });

  it("marks a side under the fingers as covered and takes covered print out of the print mask", () => {
    const { truth } = renderCategoryScene("hand", 5000);
    expect(truth.sides[2]).toBe("covered");
    const inset = maskQuad(truth.quad) * 0.81;
    expect(sum(truth.print)).toBeLessThan(inset);
    expect(sum(truth.print)).toBeGreaterThan(inset * 0.7);
  });

  it("marks screenshots as digital with the whole frame as paper", () => {
    const { truth } = renderCategoryScene("digital", 5000);
    expect(truth.kind).toBe("digital");
    expect(sum(truth.paper)).toBe(MASK_WIDTH * MASK_HEIGHT);
  });
});

describe("pointSample", () => {
  it("takes the first pixel of each 2x2 block and leaves a reduced frame alone", () => {
    const data = new Uint8ClampedArray(WIDTH * MASK_HEIGHT * 2 * 4);
    data.set([9, 8, 7, 255], (2 * WIDTH + 2) * 4);
    const small = pointSample({ data, width: WIDTH, height: MASK_HEIGHT * 2 });
    expect([
      ...small.data.subarray((1 * MASK_WIDTH + 1) * 4, (1 * MASK_WIDTH + 1) * 4 + 4),
    ]).toEqual([9, 8, 7, 255]);
    expect(pointSample(small)).toBe(small);
  });
});
