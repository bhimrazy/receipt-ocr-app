import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { otsu } from "../../src/detect/channels";
import { detectQuad } from "../../src/detect/detect-quad";
import {
  applyHomography,
  homography,
  type Pixels,
  type Point,
  type Quad,
} from "../../src/geometry";

/** Minimal decoder for the bench fixtures: 8-bit RGB or RGBA, not interlaced. */
function decodePng(file: string): Pixels {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
      if (body[8] !== 8 || body[12] !== 0) throw new Error("unsupported PNG");
    } else if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? rows[y * stride + x - channels]! : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter]!;
      rows[y * stride + x] = (v + add) & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rows[i * channels]!;
    data[i * 4 + 1] = rows[i * channels + 1]!;
    data[i * 4 + 2] = rows[i * channels + 2]!;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/**
 * A frame of `background` with `paper` (a picture, or a flat grey) projected onto `quad`, the
 * way a phone sees a receipt lying on a table.
 */
function scene(
  width: number,
  height: number,
  quad: Quad,
  paper: Pixels | number,
  background: number,
  noise = 0,
): Pixels {
  const pw = typeof paper === "number" ? 1 : paper.width;
  const ph = typeof paper === "number" ? 1 : paper.height;
  const toPaper = homography(quad, [
    { x: 0, y: 0 },
    { x: pw, y: 0 },
    { x: pw, y: ph },
    { x: 0, y: ph },
  ])!;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * noise;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyHomography(toPaper, { x: x + 0.5, y: y + 0.5 });
      let v = [background, background, background];
      if (p.x >= 0 && p.y >= 0 && p.x < pw && p.y < ph) {
        if (typeof paper === "number") v = [paper, paper, paper];
        else {
          const i = (Math.floor(p.y) * pw + Math.floor(p.x)) * 4;
          v = [paper.data[i]!, paper.data[i + 1]!, paper.data[i + 2]!];
        }
      }
      const n = rand();
      data.set([v[0]! + n, v[1]! + n, v[2]! + n, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const norm = (q: Quad, w: number, h: number) => q.map((p) => ({ x: p.x / w, y: p.y / h }));

/** Largest distance between expected and found corners, as a fraction of the frame. */
function cornerError(found: Quad, expected: Point[]) {
  return Math.max(...found.map((p, i) => Math.hypot(p.x - expected[i]!.x, p.y - expected[i]!.y)));
}

const W = 600;
const H = 800;
const tilted: Quad = [
  { x: 150, y: 120 },
  { x: 470, y: 170 },
  { x: 430, y: 690 },
  { x: 110, y: 640 },
];

describe("otsu", () => {
  it("splits a two-tone histogram between the tones", () => {
    const data = new Uint8Array(100).map((_, i) => (i < 60 ? 40 : 200));
    const t = otsu(data);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(200);
  });
});

describe("detectQuad on synthetic scenes", () => {
  it("finds a white sheet at an angle on a dark table", () => {
    const result = detectQuad(scene(W, H, tilted, 235, 40, 10));
    expect(result.quad).not.toBeNull();
    expect(cornerError(result.quad!, norm(tilted, W, H))).toBeLessThan(0.02);
    expect(result.confidence).toBeGreaterThan(0.75);
  });

  it("finds it at low contrast (light grey paper on mid grey)", () => {
    const result = detectQuad(scene(W, H, tilted, 170, 130, 6));
    expect(result.quad).not.toBeNull();
    expect(cornerError(result.quad!, norm(tilted, W, H))).toBeLessThan(0.02);
  });

  it("finds paper darker than the table by trying the inverse", () => {
    const result = detectQuad(scene(W, H, tilted, 60, 220, 6));
    expect(result.quad).not.toBeNull();
    expect(cornerError(result.quad!, norm(tilted, W, H))).toBeLessThan(0.02);
  });

  it("handles a receipt running off the bottom of the frame", () => {
    const offFrame: Quad = [
      { x: 160, y: 100 },
      { x: 440, y: 110 },
      { x: 450, y: 900 },
      { x: 150, y: 900 },
    ];
    const result = detectQuad(scene(W, H, offFrame, 235, 40, 8));
    expect(result.quad).not.toBeNull();
    const [tl, tr, br, bl] = result.quad!;
    expect(
      cornerError([tl, tr, br, bl] as Quad, [
        { x: 160 / W, y: 100 / H },
        { x: 440 / W, y: 110 / H },
        { x: 449 / W, y: 1 },
        { x: 151 / W, y: 1 },
      ]),
    ).toBeLessThan(0.03);
  });

  it("gives up on a frame with no document", () => {
    const flat = scene(W, H, tilted, 128, 128, 30);
    expect(detectQuad(flat).quad).toBeNull();
  });

  it("gives up when the paper fills the whole frame", () => {
    const full: Quad = [
      { x: -5, y: -5 },
      { x: W + 5, y: -5 },
      { x: W + 5, y: H + 5 },
      { x: -5, y: H + 5 },
    ];
    expect(detectQuad(scene(W, H, full, 235, 40)).quad).toBeNull();
  });

  it("gives up on a round object (not four straight sides)", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.hypot(x - 300, y - 400) < 220 ? 235 : 40;
        data.set([v, v, v, 255], (y * W + x) * 4);
      }
    }
    expect(detectQuad({ data, width: W, height: H }).quad).toBeNull();
  });

  it("is fast at the detection size", () => {
    const img = scene(1200, 1600, tilted.map((p) => ({ x: p.x * 2, y: p.y * 2 })) as Quad, 235, 40);
    const start = performance.now();
    detectQuad(img);
    // Most of this is the full-resolution downscale, which the browser does on a canvas instead.
    expect(performance.now() - start).toBeLessThan(500);
  });
});

type Tone = number | ((u: number, v: number) => number);

/**
 * `layers` painted in order over `background`, each a tone (or a function of 0..1 paper
 * coordinates) on a quad, then everything multiplied by `light` (shadows, gradients).
 */
function paint(
  background: (x: number, y: number) => number,
  layers: { quad: Quad; tone: Tone }[],
  noise = 8,
  light: (x: number, y: number) => number = () => 1,
): Pixels {
  const unit: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const maps = layers.map((l) => ({ toUnit: homography(l.quad, unit)!, tone: l.tone }));
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * noise;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = background(x, y);
      for (const { toUnit, tone } of maps) {
        const p = applyHomography(toUnit, { x: x + 0.5, y: y + 0.5 });
        if (p.x < 0 || p.y < 0 || p.x >= 1 || p.y >= 1) continue;
        v = typeof tone === "number" ? tone : tone(p.x, p.y);
      }
      v *= light(x, y);
      const n = rand();
      data.set([v + n, v + n, v + n, 255], (y * W + x) * 4);
    }
  }
  return { data, width: W, height: H };
}

const box = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
/** White paper with rows of grey print; `shade` overrides the paper's tone. */
const printed =
  (shade: (u: number, v: number) => number = () => 235) =>
  (u: number, v: number) =>
    shade(u, v) - (u > 0.08 && u < 0.9 && v > 0.05 && v < 0.95 && (v * 40) % 1 < 0.2 ? 150 : 0);
const darkTable = () => 40;
const woodTable = (x: number, y: number) => 70 + 25 * Math.sin(x / 9 + Math.sin(y / 40) * 2);

/** A 260x460 sheet turned `deg` degrees about the frame's centre. */
function turned(deg: number): Quad {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const at = (x: number, y: number) => ({ x: 300 + x * c - y * s, y: 400 + x * s + y * c });
  return [at(-130, -230), at(130, -230), at(130, 230), at(-130, 230)];
}
/** Light falling off from 1 on the right to 0.55 on the left. */
const gradient = (x: number) => 0.55 + (0.45 * x) / W;

describe("detectQuad: cropping a photo nobody reviews", () => {
  it("applies the outline of a printed receipt on a dark table", () => {
    const result = detectQuad(paint(darkTable, [{ quad: tilted, tone: printed() }]));
    expect(result.level).toBe("apply");
    expect(cornerError(result.quad!, norm(tilted, W, H))).toBeLessThan(0.02);
  });

  it("applies it on wood grain, under uneven light, and turned up to 44 degrees", () => {
    const sheet = [{ quad: tilted, tone: printed() }];
    expect(detectQuad(paint(woodTable, sheet)).level).toBe("apply");
    expect(detectQuad(paint(woodTable, sheet, 8, gradient)).level).toBe("apply");
    expect(detectQuad(paint(() => 110, sheet, 8, gradient)).level).toBe("apply");
    expect(detectQuad(paint(woodTable, [{ quad: turned(44), tone: printed() }])).level).toBe(
      "apply",
    );
  });

  it("applies the whole sheet under a shadow too faint to split it", () => {
    const result = detectQuad(
      paint(darkTable, [{ quad: tilted, tone: printed() }], 8, (x, y) =>
        x * 0.9 + y * 0.35 > 520 ? 0.6 : 1,
      ),
    );
    expect(result.level).toBe("apply");
    expect(cornerError(result.quad!, norm(tilted, W, H))).toBeLessThan(0.02);
  });

  it("returns nothing for a white receipt on a light table", () => {
    expect(detectQuad(paint(() => 215, [{ quad: tilted, tone: printed() }])).level).toBe("none");
  });

  // Each case below fails exactly one apply rule, so removing any rule fails a test.

  it("suggests a blob darker than its surroundings (dark card in a screenshot, dark paper)", () => {
    const card = paint(() => 250, [{ quad: box(30, 100, 570, 290), tone: 90 }], 0);
    expect(detectQuad(card).level).toBe("suggest");
    expect(detectQuad(scene(W, H, tilted, 60, 220, 6)).level).toBe("suggest");
  });

  it("finds a long 1:5 receipt at 80% of the frame's height, but only suggests it (17% cover)", () => {
    const tall = box(236, 80, 364, 720);
    const result = detectQuad(paint(darkTable, [{ quad: tall, tone: printed() }]));
    expect(result.level).toBe("suggest");
    expect(cornerError(result.quad!, norm(tall, W, H))).toBeLessThan(0.02);
  });

  it("suggests a receipt with a corner past the frame", () => {
    const poking: Quad = [
      { x: 150, y: -10 },
      { x: 470, y: 60 },
      { x: 430, y: 690 },
      { x: 110, y: 640 },
    ];
    expect(detectQuad(paint(darkTable, [{ quad: poking, tone: printed() }])).level).toBe("suggest");
  });

  it("suggests a receipt with a light note stuck to its side", () => {
    const result = detectQuad(
      paint(darkTable, [
        { quad: tilted, tone: printed() },
        { quad: box(440, 380, 520, 450), tone: 225 },
      ]),
    );
    expect(result.level).toBe("suggest");
  });

  it("suggests when a dark header band splits off the top of the paper", () => {
    const header = (u: number, v: number) => (v > 0.06 && v < 0.1 ? 35 : printed()(u, v));
    expect(detectQuad(paint(darkTable, [{ quad: tilted, tone: header }])).level).toBe("suggest");
  });

  it("suggests when another light paper lies apart from the receipt", () => {
    const result = detectQuad(
      paint(darkTable, [
        { quad: box(120, 100, 400, 700), tone: printed() },
        { quad: box(440, 560, 560, 680), tone: printed() },
      ]),
    );
    expect(result.level).toBe("suggest");
  });

  it("suggests when every edge is faint", () => {
    expect(detectQuad(paint(() => 140, [{ quad: tilted, tone: 160 }], 4)).level).toBe("suggest");
  });

  it("suggests when one side borders something much lighter than the table", () => {
    const result = detectQuad(
      paint(
        () => 10,
        [
          { quad: box(150, 100, 450, 700), tone: printed() },
          { quad: box(452, 130, 520, 670), tone: 110 },
        ],
        4,
      ),
    );
    expect(result.level).toBe("suggest");
  });

  it("suggests when a cast shadow across paper and table cuts the sheet short", () => {
    const sheet = [{ quad: box(100, 60, 500, 760), tone: printed() }];
    const shadow = (_: number, y: number) => (y > 500 ? 0.45 : 1);
    expect(detectQuad(paint(() => 110, sheet, 8, shadow)).level).toBe("suggest");
    const onWood = detectQuad(
      paint(
        woodTable,
        [
          {
            quad: [
              { x: 120, y: 60 },
              { x: 500, y: 100 },
              { x: 470, y: 760 },
              { x: 90, y: 730 },
            ],
            tone: printed(),
          },
        ],
        8,
        (_, y) => (y > 520 ? 0.5 : 1),
      ),
    );
    expect(onWood.level).toBe("suggest");
  });

  it("only suggests a receipt that runs off the frame, or a screenshot's page in app chrome", () => {
    expect(detectQuad(scene(W, H, box(160, 100, 440, 900), 235, 40, 8)).level).toBe("suggest");
    const screenshot = paint(
      () => 30,
      [
        { quad: box(0, 90, 600, 720), tone: printed() },
        { quad: box(0, 90, 600, 170), tone: 90 },
      ],
      0,
    );
    expect(detectQuad(screenshot).level).toBe("suggest");
  });

  it("suggests when light objects touch the receipt, or fingers hold it", () => {
    const touching = paint(darkTable, [
      { quad: box(20, 600, 200, 780), tone: 220 },
      { quad: box(420, 40, 590, 160), tone: 210 },
      { quad: tilted, tone: printed() },
      { quad: box(440, 380, 560, 470), tone: 225 },
    ]);
    expect(detectQuad(touching).level).toBe("suggest");
    const fingers = [box(90, 580, 160, 800), box(140, 620, 260, 800)].map((quad) => ({
      quad,
      tone: 170,
    }));
    const onTable = paint(darkTable, [{ quad: tilted, tone: printed() }, ...fingers]);
    expect(detectQuad(onTable).level).toBe("suggest");
    const byWall = paint(
      (_, y) => (y < 350 ? 200 : 60),
      [{ quad: tilted, tone: printed() }, ...fingers],
    );
    expect(detectQuad(byWall).level).toBe("suggest");
  });
});

describe("detectQuad on bench receipts", () => {
  const fixtures = path.join(import.meta.dirname, "../../../bench/fixtures");
  for (const name of ["npr-lakh", "long-groceries"]) {
    it(`finds ${name} placed at an angle on a dark table`, () => {
      const receipt = decodePng(path.join(fixtures, `${name}.png`));
      // Keep the receipt's aspect, fit it in 70% of the frame, then tilt the corners.
      const scale = Math.min((W * 0.7) / receipt.width, (H * 0.7) / receipt.height);
      const w = receipt.width * scale;
      const h = receipt.height * scale;
      const x0 = (W - w) / 2;
      const y0 = (H - h) / 2;
      const quad: Quad = [
        { x: x0 + 25, y: y0 },
        { x: x0 + w + 10, y: y0 + 30 },
        { x: x0 + w - 20, y: y0 + h },
        { x: x0 - 10, y: y0 + h - 25 },
      ];
      const result = detectQuad(scene(W, H, quad, receipt, 55, 10));
      expect(result.quad).not.toBeNull();
      expect(cornerError(result.quad!, norm(quad, W, H))).toBeLessThan(0.025);
    });
  }

  it("leaves a flat scan that fills the frame uncropped", () => {
    const receipt = decodePng(path.join(fixtures, "usd-tip.png"));
    expect(detectQuad(receipt).quad).toBeNull();
  });
});

/**
 * A crumpled light receipt on a dark table, the shape the owner hit: the crop spilled past the
 * paper in a strip on the left and bottom. Two causes reproduce it, and both are known limits of
 * a four-corner detector on a thresholded mask (see docs/STATUS.md):
 *
 * - Crumpled sides bow inward between the corners. The detector keeps the true corners, so the
 *   straight sides of the quad cut across the bow and take in a strip of table. No quad can
 *   follow a curved side; moving the side in would cut paper off at the corners instead.
 * - Light bouncing off the table makes a lighter band beside the paper. Above the threshold it
 *   joins the paper's component, and the quad grows by the band's width.
 *
 * The `fails` cases state the outcome a better detector (edge-based line fitting) should reach;
 * they start passing, and so fail here, when it does.
 */
describe("detectQuad on a crumpled receipt (known limits)", () => {
  const corners: Quad = [
    { x: 170, y: 110 },
    { x: 450, y: 120 },
    { x: 440, y: 700 },
    { x: 160, y: 690 },
  ];
  const [tl, tr, br, bl] = corners;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
  /** Inside the paper, whose left and bottom sides bow inward by `bow` px at their middle. */
  const onPaper = (x: number, y: number, bow: number) => {
    const ty = clamp01((y - tl.y) / (bl.y - tl.y));
    const tx = clamp01((x - bl.x) / (br.x - bl.x));
    const left = lerp(tl.x, bl.x, ty) + bow * Math.sin(Math.PI * ty);
    const bottom = lerp(bl.y, br.y, tx) - bow * Math.sin(Math.PI * tx);
    const right = lerp(tr.x, br.x, (y - tr.y) / (br.y - tr.y));
    const top = lerp(tl.y, tr.y, (x - tl.x) / (tr.x - tl.x));
    return x > left && x < right && y > top && y < bottom;
  };
  /** The paper with soft crease shading, on a dark table, plus a lighter `band` px beside it. */
  function crumpled(bow: number, band = 0, bandLevel = 140): Pixels {
    const data = new Uint8ClampedArray(W * H * 4);
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 12;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 38;
        if (onPaper(x, y, bow)) {
          const crease =
            Math.abs(Math.sin((x * 0.9 + y * 0.6) / 37)) * Math.abs(Math.cos((x * 0.4 - y) / 53));
          v = 232 - 70 * crease ** 3;
        } else if (
          band > 0 &&
          ((x > bl.x - band && x <= tl.x + 2 && y > tl.y && y < br.y) ||
            (y < br.y + band && y >= bl.y - 2 && x > bl.x - band && x < br.x + 5))
        ) {
          v = bandLevel;
        }
        const n = rand();
        data.set([v + n, v + n, v + n, 255], (y * W + x) * 4);
      }
    }
    return { data, width: W, height: H };
  }
  /** Where the found left side crosses the paper's middle row, and the bottom its middle column. */
  function middles(quad: Quad) {
    const [qtl, , qbr, qbl] = quad.map((p) => ({ x: p.x * W, y: p.y * H }));
    const midY = (tl.y + bl.y) / 2;
    const midX = (bl.x + br.x) / 2;
    return {
      left: lerp(qtl!.x, qbl!.x, (midY - qtl!.y) / (qbl!.y - qtl!.y)),
      bottom: lerp(qbl!.y, qbr!.y, (midX - qbl!.x) / (qbr!.x - qbl!.x)),
    };
  }
  const BOW = 24;

  it("still finds the corners, and never cuts into the paper", () => {
    const result = detectQuad(crumpled(BOW));
    expect(result.quad).not.toBeNull();
    expect(cornerError(result.quad!, norm(corners, W, H))).toBeLessThan(0.02);
    // The paper's bowed sides lie inside the found sides, so no print is cropped off.
    const { left, bottom } = middles(result.quad!);
    expect(left).toBeLessThan(lerp(tl.x, bl.x, 0.5) + BOW);
    expect(bottom).toBeGreaterThan(lerp(bl.y, br.y, 0.5) - BOW);
  });

  it.fails("follows bowed sides instead of spilling a strip of table inside the crop", () => {
    const { left, bottom } = middles(detectQuad(crumpled(BOW)).quad!);
    // The paper's edge in the middle of each bowed side, within 1% of the frame.
    expect(Math.abs(left - (lerp(tl.x, bl.x, 0.5) + BOW))).toBeLessThan(W * 0.01);
    expect(Math.abs(bottom - (lerp(bl.y, br.y, 0.5) - BOW))).toBeLessThan(H * 0.01);
  });

  it.fails("leaves out a lighter band of table beside the paper", () => {
    const result = detectQuad(crumpled(0, 16));
    expect(cornerError(result.quad!, norm(corners, W, H))).toBeLessThan(0.01);
  });
});
