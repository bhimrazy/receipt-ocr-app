import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { detectQuad, otsu } from "./detect-quad";
import { applyHomography, homography, type Pixels, type Point, type Quad } from "./geometry";

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

describe("detectQuad on bench receipts", () => {
  const fixtures = path.join(import.meta.dirname, "../../../../bench/fixtures");
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
