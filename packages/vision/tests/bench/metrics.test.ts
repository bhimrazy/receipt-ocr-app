import { describe, expect, it } from "vitest";
import {
  compareToBaseline,
  cornerError,
  encodeOutcomes,
  levelAccuracy,
  scoreScene,
  summarise,
  weighted,
  type SceneResult,
} from "../../bench/metrics";
import { MASK_HEIGHT, MASK_WIDTH, type Truth } from "../../bench/scene";
import type { Detection } from "../../src/detect/detect-quad";
import type { Quad } from "../../src/geometry";

const box = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Paper covering 0.2..0.8 of the frame, print inside its inner 90%. */
function truthOf(kind: Truth["kind"] = "paper"): Truth {
  const paper = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
  const print = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
  for (let y = 0; y < MASK_HEIGHT; y++) {
    for (let x = 0; x < MASK_WIDTH; x++) {
      const u = (x + 0.5) / MASK_WIDTH;
      const v = (y + 0.5) / MASK_HEIGHT;
      if (u > 0.2 && u < 0.8 && v > 0.2 && v < 0.8) paper[y * MASK_WIDTH + x] = 1;
      if (u > 0.23 && u < 0.77 && v > 0.23 && v < 0.77) print[y * MASK_WIDTH + x] = 1;
    }
  }
  return {
    kind,
    quad: box(0.2, 0.2, 0.8, 0.8),
    cornersInFrame: true,
    paper,
    print,
    variant: "test",
  };
}

const found = (quad: Quad | null, level: Detection["level"] = "apply"): Detection => ({
  quad,
  confidence: 1,
  level,
});

describe("scoreScene", () => {
  it("calls a tight quad good and measures its corners", () => {
    const r = scoreScene(truthOf(), found(box(0.2, 0.2, 0.8, 0.8)));
    expect(r.outcome).toBe("good");
    expect(r.iou).toBeGreaterThan(0.98);
    expect(r.cornerError).toBeLessThan(0.001);
  });

  it("calls no quad a miss", () => {
    expect(scoreScene(truthOf(), found(null, "none")).outcome).toBe("miss");
  });

  it("calls a quad that keeps the print but takes in the table loose", () => {
    const r = scoreScene(truthOf(), found(box(0.05, 0.05, 0.95, 0.95)));
    expect(r.outcome).toBe("loose");
    expect(r.cornerError).toBeNull();
  });

  it("calls a quad that cuts print harmful, and ignores a trim of blank margin", () => {
    expect(scoreScene(truthOf(), found(box(0.2, 0.2, 0.8, 0.7))).outcome).toBe("harmful");
    expect(scoreScene(truthOf(), found(box(0.22, 0.22, 0.78, 0.78))).outcome).toBe("good");
  });

  it("accepts corners listed from another starting corner", () => {
    const q = box(0.2, 0.2, 0.8, 0.8);
    expect(cornerError([q[2], q[3], q[0], q[1]], q)).toBe(0);
  });

  it("scores a screenshot good with no quad or a near-full one, harmful when it crops", () => {
    const t = truthOf("digital");
    expect(scoreScene(t, found(null, "none")).outcome).toBe("good");
    expect(scoreScene(t, found(box(0, 0, 1, 1))).outcome).toBe("good");
    expect(scoreScene(t, found(box(0, 0.1, 1, 1))).outcome).toBe("harmful");
  });
});

const result = (
  outcome: SceneResult["outcome"],
  extra: Partial<SceneResult> = {},
): SceneResult => ({
  outcome,
  iou: null,
  cornerError: null,
  level: "none",
  ...extra,
});

describe("aggregation", () => {
  it("summarises rates, IoU and corner quantiles", () => {
    const s = summarise([
      result("good", { iou: 0.9, cornerError: 0.01 }),
      result("good", { iou: 0.8, cornerError: 0.03 }),
      result("miss"),
      result("harmful", { iou: 0.5 }),
    ]);
    expect(s).toMatchObject({ n: 4, good: 0.5, miss: 0.25, harmful: 0.25, loose: 0 });
    expect(s.meanIou).toBeCloseTo(0.7333, 3);
    expect(s.cornerMedian).toBe(0.03);
  });

  it("normalises weights that do not sum to 100", () => {
    const a = summarise([result("good")]);
    const b = summarise([result("harmful")]);
    expect(
      weighted([
        { weight: 3, stats: a },
        { weight: 1, stats: b },
      ]),
    ).toMatchObject({ good: 0.75, harmful: 0.25 });
  });

  it("counts applied crops that cut print and suggestions that were right", () => {
    const acc = levelAccuracy([
      result("good", { level: "apply" }),
      result("harmful", { level: "apply" }),
      result("good", { level: "suggest" }),
      result("loose", { level: "suggest" }),
      result("miss"),
    ]);
    expect(acc).toEqual({ applied: 2, appliedHarmful: 1, suggested: 2, suggestedGood: 1 });
  });
});

describe("compareToBaseline", () => {
  const row = (outcomes: string) => [{ id: "a", weight: 1, outcomes }];

  it("passes an unchanged or better run", () => {
    expect(compareToBaseline(row("ggghm"), row("ggghm"))).toEqual([]);
    expect(compareToBaseline(row("ggghm"), row("gggmm"))).toEqual([]);
  });

  it("flags more harmful scenes and fewer good ones", () => {
    expect(compareToBaseline(row("gggg"), row("gggh")).join()).toContain("harmful");
    expect(compareToBaseline(row("gggg"), row("gglm")).join()).toContain("good");
  });

  it("flags a category that gains two harmful scenes even when the total is offset elsewhere", () => {
    const base = [
      { id: "a", weight: 1, outcomes: "gggg" },
      { id: "b", weight: 100, outcomes: "hhhh" },
    ];
    const now = [
      { id: "a", weight: 1, outcomes: "gghh" },
      { id: "b", weight: 100, outcomes: "gggg" },
    ];
    expect(compareToBaseline(base, now).join()).toContain("a: more than one new harmful");
  });

  it("encodes one letter per scene", () => {
    expect(
      encodeOutcomes([result("good"), result("loose"), result("miss"), result("harmful")]),
    ).toBe("glmh");
  });
});
