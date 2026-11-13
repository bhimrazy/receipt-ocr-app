import { homography, type Pixels, type Point, type Quad } from "../src/geometry";
import { hash3, mulberry32, valueNoise } from "./rng";

export const WIDTH = 384;
export const HEIGHT = 512;
/** Truth masks are kept at the detector's working size (half the render). */
export const MASK_WIDTH = WIDTH / 2;
export const MASK_HEIGHT = HEIGHT / 2;

export type RGB = [number, number, number];

export type Background =
  | { kind: "flat"; color: RGB }
  | { kind: "wood"; color: RGB; angle: number; freq: number; contrast: number }
  | { kind: "check"; a: RGB; b: RGB; cell: number; angle: number }
  | { kind: "twill"; color: RGB }
  | { kind: "fabric"; color: RGB }
  | { kind: "sheet"; color: RGB };

/** A convex polygon painted over the background; `soft` > 0 feathers its edge (a cast shadow). */
export type Shape = { pts: Point[]; color: RGB; alpha: number; soft?: number };

export type PaperSpec = {
  quad: Quad;
  /** The receipt the scene is scored on. */
  main?: boolean;
  tone: RGB;
  inkColor: RGB;
  ink: number;
  seed: number;
  /** Outward bow of the left, top, right and bottom sides, as a share of the side's length. */
  bows: [number, number, number, number];
  creases: { nu: number; nv: number; offset: number; depth: number; width: number }[];
  fold?: { v: number; step: number };
  /** Darkening toward the left and right ends, for a receipt held in a curve. */
  curl: number;
};

export type Capsule = { a: Point; b: Point; r: number; color: RGB };

export type Light = {
  gain: number;
  vignette: number;
  noise: number;
  shadow?:
    | { kind: "half"; nx: number; ny: number; offset: number; soft: number; strength: number }
    | { kind: "blob"; cx: number; cy: number; rx: number; ry: number; strength: number };
  glare?: { x: number; y: number; sigma: number; strength: number };
};

export type Camera = {
  /** Half-width in pixels of the defocus blur. */
  defocus: number;
  /** Motion blur: half-length in pixels along (dx, dy). */
  motion?: { dx: number; dy: number; n: number };
  /** How the render is reduced to the detector's size: averaged, or the first pixel of each 2x2 block. */
  sample: "area" | "point";
  jpeg: boolean;
};

export type DigitalSpec = {
  page: RGB;
  inkColor: RGB;
  margin: number;
  /** Height in pixels of a grey status bar across the top, 0 for none. */
  chrome: number;
  /** An app header band across the top: colour and height in pixels. */
  bar?: { height: number; color: RGB };
  /** A bar across the bottom, like a phone's navigation bar. */
  navBar?: { height: number; color: RGB };
  /** The page as a card inset from the frame on a grey backdrop. */
  card?: { inset: number; backdrop: RGB };
  seed: number;
};

export type SceneSpec = {
  variant: string;
  bg: Background;
  shapes: Shape[];
  papers: PaperSpec[];
  occluders: Capsule[];
  light: Light;
  camera: Camera;
  digital?: DigitalSpec;
};

export type SideState = "visible" | "covered" | "off-frame";

export type Truth = {
  kind: "paper" | "digital";
  /** The paper's corners in 0..1 of the frame; outside that range when the paper runs off it. */
  quad: Quad;
  cornersInFrame: boolean;
  /** What a good detector does: crop to the paper, or leave a screenshot alone. */
  expected: "crop" | "none";
  /** Per side (top, right, bottom, left): seen, mostly under something, or mostly outside the frame. */
  sides: [SideState, SideState, SideState, SideState];
  /** Paper pixels, with bowed sides, including the part under a finger. */
  paper: Uint8Array;
  /** Visible print: the paper inset by 5% and not covered by another object. */
  print: Uint8Array;
  variant: string;
};

export type Scene = { pixels: Pixels; truth: Truth };

const OWNER_MAIN = 1;
const OWNER_OTHER = 2;

type Ctx = {
  rgb: Float32Array;
  owner: Uint8Array;
  paper: Uint8Array;
  inPrint: Uint8Array;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function backgroundAt(bg: Background, seed: number): (x: number, y: number, out: RGB) => void {
  switch (bg.kind) {
    case "flat":
      return (_x, _y, out) => {
        out[0] = bg.color[0];
        out[1] = bg.color[1];
        out[2] = bg.color[2];
      };
    case "wood": {
      const c = Math.cos(bg.angle);
      const s = Math.sin(bg.angle);
      return (x, y, out) => {
        const along = x * c + y * s;
        const across = -x * s + y * c;
        const warp = valueNoise(along * 0.01, across * 0.03, seed) * 7;
        const grain = Math.sin(across * bg.freq + warp);
        const fine = valueNoise(along * 0.08, across * 0.7, seed + 1) - 0.5;
        const k = 1 + bg.contrast * (0.6 * grain + 0.8 * fine);
        out[0] = bg.color[0] * k;
        out[1] = bg.color[1] * k;
        out[2] = bg.color[2] * k;
      };
    }
    case "check": {
      const c = Math.cos(bg.angle);
      const s = Math.sin(bg.angle);
      return (x, y, out) => {
        const u = Math.floor((x * c + y * s) / bg.cell);
        const v = Math.floor((-x * s + y * c) / bg.cell);
        const col = (u + v) & 1 ? bg.a : bg.b;
        const k = 0.94 + 0.12 * valueNoise(x * 0.5, y * 0.5, seed);
        out[0] = col[0] * k;
        out[1] = col[1] * k;
        out[2] = col[2] * k;
      };
    }
    case "twill":
      return (x, y, out) => {
        const k =
          1 + 0.1 * Math.sin((x + y) * 1.2) + 0.25 * (valueNoise(x * 0.06, y * 0.06, seed) - 0.5);
        out[0] = bg.color[0] * k;
        out[1] = bg.color[1] * k;
        out[2] = bg.color[2] * k;
      };
    case "fabric":
      return (x, y, out) => {
        const k =
          0.9 +
          0.2 * valueNoise(x * 0.7, y * 0.7, seed) +
          0.1 * valueNoise(x * 0.05, y * 0.05, seed + 1);
        out[0] = bg.color[0] * k;
        out[1] = bg.color[1] * k;
        out[2] = bg.color[2] * k;
      };
    case "sheet":
      return (x, y, out) => {
        const k =
          0.95 +
          0.1 * valueNoise(x * 0.012, y * 0.02, seed) +
          0.04 * valueNoise(x * 0.05, y * 0.03, seed + 1);
        out[0] = bg.color[0] * k;
        out[1] = bg.color[1] * k;
        out[2] = bg.color[2] * k;
      };
  }
}

type Edges = { cx: Float64Array; cy: Float64Array; c0: Float64Array; n: number };

/** Inward signed distance from each edge of a convex polygon, as a linear function of (x, y). */
function edgesOf(pts: Point[]): Edges {
  const n = pts.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  const sign = area2 >= 0 ? 1 : -1;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const c0 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    cx[i] = (-(b.y - a.y) * sign) / len;
    cy[i] = ((b.x - a.x) * sign) / len;
    c0[i] = -(cx[i]! * a.x + cy[i]! * a.y);
  }
  return { cx, cy, c0, n };
}

function bounds(pts: Point[], pad: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return {
    x0: Math.max(0, Math.floor(x0 - pad)),
    y0: Math.max(0, Math.floor(y0 - pad)),
    x1: Math.min(WIDTH - 1, Math.ceil(x1 + pad)),
    y1: Math.min(HEIGHT - 1, Math.ceil(y1 + pad)),
  };
}

function blend(ctx: Ctx, i: number, color: RGB, cov: number) {
  const o = i * 3;
  const rgb = ctx.rgb;
  rgb[o] = rgb[o]! + (color[0] - rgb[o]!) * cov;
  rgb[o + 1] = rgb[o + 1]! + (color[1] - rgb[o + 1]!) * cov;
  rgb[o + 2] = rgb[o + 2]! + (color[2] - rgb[o + 2]!) * cov;
}

function fillShape(ctx: Ctx, shape: Shape) {
  const e = edgesOf(shape.pts);
  const soft = shape.soft ?? 0;
  const b = bounds(shape.pts, soft);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let d = Infinity;
      for (let k = 0; k < e.n; k++) d = Math.min(d, e.cx[k]! * px + e.cy[k]! * py + e.c0[k]!);
      const cov = soft ? clamp01((d + soft) / (2 * soft)) : clamp01(d + 0.5);
      if (cov > 0) blend(ctx, y * WIDTH + x, shape.color, cov * shape.alpha);
    }
  }
}

function fillCapsule(ctx: Ctx, cap: Capsule) {
  const { a, b, r } = cap;
  const pad = r + 1;
  const bb = bounds([a, b], pad);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  for (let y = bb.y0; y <= bb.y1; y++) {
    for (let x = bb.x0; x <= bb.x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = clamp01(((px - a.x) * abx + (py - a.y) * aby) / len2);
      const d = Math.hypot(px - (a.x + abx * t), py - (a.y + aby * t));
      const cov = clamp01(r - d + 0.5);
      if (cov <= 0) continue;
      const shade = 0.82 + 0.18 * (1 - d / r);
      const i = y * WIDTH + x;
      blend(ctx, i, [cap.color[0] * shade, cap.color[1] * shade, cap.color[2] * shade], cov);
      if (cov >= 0.5) ctx.owner[i] = 3;
    }
  }
}

/** 1 where a glyph is, over a print area of `w` x `h` px with `u`, `v` in 0..1. */
function glyph(
  u: number,
  v: number,
  w: number,
  h: number,
  seed: number,
  pitch: number,
  charW: number,
): number {
  if (v < 0.07 && u > 0.28 && u < 0.72) return 1;
  const rowF = (v * h) / pitch;
  const row = Math.floor(rowF);
  if (rowF - row > 0.62) return 0;
  const colF = (u * w) / charW;
  const col = Math.floor(colF);
  if (colF - col > 0.7) return 0;
  if (hash3(row, 7, seed) < 0.14) return 0;
  const reach = 0.3 + 0.7 * hash3(row, 11, seed);
  if (u > reach && !(u > 0.78 && hash3(row, 13, seed) < 0.5)) return 0;
  return hash3(row * 131 + col, 3, seed) < 0.64 ? 1 : 0;
}

function drawPaper(ctx: Ctx, p: PaperSpec) {
  const unit: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const h = homography(p.quad, unit);
  if (!h) throw new Error("degenerate paper quad");
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = p.quad;
  const wp = (len(tl, tr) + len(bl, br)) / 2;
  const hp = (len(tl, bl) + len(tr, br)) / 2;
  const [bowL, bowT, bowR, bowB] = p.bows;
  const bb = bounds(p.quad, Math.max(...p.bows.map(Math.abs)) * Math.max(wp, hp) + 2);
  const owner = p.main ? OWNER_MAIN : OWNER_OTHER;
  for (let y = bb.y0; y <= bb.y1; y++) {
    for (let x = bb.x0; x <= bb.x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w = h6 * px + h7 * py + h8;
      const u = (h0 * px + h1 * py + h2) / w;
      const v = (h3 * px + h4 * py + h5) / w;
      const su = 4 * u * (1 - u);
      const sv = 4 * v * (1 - v);
      const d = Math.min(
        (u + bowL * sv) * wp,
        (1 - u + bowR * sv) * wp,
        (v + bowT * su) * hp,
        (1 - v + bowB * su) * hp,
      );
      const cov = clamp01(d + 0.5);
      if (cov <= 0) continue;
      let shade = 1;
      for (const c of p.creases) {
        const t = (c.nu * u + c.nv * v - c.offset) / c.width;
        shade *= 1 - c.depth * Math.exp(-t * t);
      }
      if (p.fold) {
        if (v > p.fold.v) shade *= p.fold.step;
        const t = (v - p.fold.v) / 0.012;
        shade *= 1 - 0.1 * Math.exp(-t * t);
      }
      if (p.curl) shade *= 1 - p.curl * (2 * u - 1) ** 2;
      shade *= 0.99 + 0.02 * hash3(x, y, p.seed);
      const pu = (u - 0.05) / 0.9;
      const pv = (v - 0.05) / 0.9;
      const inside = pu >= 0 && pu <= 1 && pv >= 0 && pv <= 1;
      const a = inside ? p.ink * glyph(pu, pv, 0.9 * wp, 0.9 * hp, p.seed, 7.5, 5) : 0;
      const col: RGB = [
        (p.tone[0] + (p.inkColor[0] - p.tone[0]) * a) * shade,
        (p.tone[1] + (p.inkColor[1] - p.tone[1]) * a) * shade,
        (p.tone[2] + (p.inkColor[2] - p.tone[2]) * a) * shade,
      ];
      const i = y * WIDTH + x;
      blend(ctx, i, col, cov);
      if (cov >= 0.5) {
        ctx.owner[i] = owner;
        if (p.main) {
          ctx.paper[i] = 1;
          if (inside) ctx.inPrint[i] = 1;
        }
      }
    }
  }
}

function drawDigital(ctx: Ctx, d: DigitalSpec) {
  const w = WIDTH * (1 - 2 * d.margin);
  const h = HEIGHT * 0.9;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5 - WIDTH * d.margin) / w;
      const v = (y + 0.5 - HEIGHT * 0.05) / h;
      const inText = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      const a = inText ? glyph(u, v, w, h, d.seed, 11, 7) : 0;
      const o = (y * WIDTH + x) * 3;
      const inCard =
        !d.card ||
        (x >= d.card.inset &&
          x < WIDTH - d.card.inset &&
          y >= d.card.inset &&
          y < HEIGHT - d.card.inset);
      for (let c = 0; c < 3; c++) {
        ctx.rgb[o + c] = inCard
          ? d.page[c]! + (d.inkColor[c]! - d.page[c]!) * a * 0.9
          : d.card!.backdrop[c]!;
      }
      if (y < d.chrome) ctx.rgb[o] = ctx.rgb[o + 1] = ctx.rgb[o + 2] = 205;
      if (d.navBar && y >= HEIGHT - d.navBar.height)
        for (let c = 0; c < 3; c++) ctx.rgb[o + c] = d.navBar.color[c]!;
      if (d.bar && y < d.bar.height) for (let c = 0; c < 3; c++) ctx.rgb[o + c] = d.bar.color[c]!;
    }
  }
  ctx.paper.fill(1);
  ctx.inPrint.fill(1);
  ctx.owner.fill(OWNER_MAIN);
}

function lineBlur(src: Float32Array, dx: number, dy: number, n: number): Float32Array {
  const out = new Float32Array(src.length);
  const norm = 1 / (2 * n + 1);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -n; k <= n; k++) {
        const xx = Math.min(WIDTH - 1, Math.max(0, Math.round(x + k * dx)));
        const yy = Math.min(HEIGHT - 1, Math.max(0, Math.round(y + k * dy)));
        const o = (yy * WIDTH + xx) * 3;
        r += src[o]!;
        g += src[o + 1]!;
        b += src[o + 2]!;
      }
      const o = (y * WIDTH + x) * 3;
      out[o] = r * norm;
      out[o + 1] = g * norm;
      out[o + 2] = b * norm;
    }
  }
  return out;
}

function light(rgb: Float32Array, l: Light) {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r2 = ((x - cx) / cx) ** 2 / 2 + ((y - cy) / cy) ** 2 / 2;
      let m = l.gain * (1 - l.vignette * r2);
      const s = l.shadow;
      if (s?.kind === "half") {
        const t = (s.nx * x + s.ny * y - s.offset) / s.soft;
        m *= 1 - s.strength * clamp01(0.5 + t / 2);
      } else if (s?.kind === "blob") {
        const dd = Math.hypot((x - s.cx) / s.rx, (y - s.cy) / s.ry);
        m *= 1 - s.strength * clamp01((1.2 - dd) / 0.4);
      }
      let add = 0;
      if (l.glare) {
        const g = l.glare;
        add = g.strength * 255 * Math.exp(-((x - g.x) ** 2 + (y - g.y) ** 2) / (2 * g.sigma ** 2));
      }
      const o = (y * WIDTH + x) * 3;
      rgb[o] = rgb[o]! * m + add;
      rgb[o + 1] = rgb[o + 1]! * m + add;
      rgb[o + 2] = rgb[o + 2]! * m + add;
    }
  }
}

/** Crude JPEG: each 8x8 block keeps a coarse mean and a quantised residual. */
function jpegify(px: Uint8ClampedArray) {
  for (let by = 0; by < HEIGHT; by += 8) {
    for (let bx = 0; bx < WIDTH; bx += 8) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let y = by; y < by + 8; y++)
          for (let x = bx; x < bx + 8; x++) sum += px[(y * WIDTH + x) * 4 + c]!;
        const mean = sum / 64;
        const q = Math.round(mean / 4) * 4;
        for (let y = by; y < by + 8; y++) {
          for (let x = bx; x < bx + 8; x++) {
            const i = (y * WIDTH + x) * 4 + c;
            px[i] = q + Math.round((px[i]! - mean) / 14) * 14;
          }
        }
      }
    }
  }
}

/** The first pixel of each 2x2 block: how a browser that point-samples reduces a frame to the detector's size. */
export function pointSample(p: Pixels): Pixels {
  if (p.width !== WIDTH) return p;
  const data = new Uint8ClampedArray(MASK_WIDTH * MASK_HEIGHT * 4);
  for (let y = 0; y < MASK_HEIGHT; y++) {
    for (let x = 0; x < MASK_WIDTH; x++) {
      const s = (y * 2 * WIDTH + x * 2) * 4;
      data.set(p.data.subarray(s, s + 4), (y * MASK_WIDTH + x) * 4);
    }
  }
  return { data, width: MASK_WIDTH, height: MASK_HEIGHT };
}

export function renderScene(spec: SceneSpec, seed: number): Scene {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const n = WIDTH * HEIGHT;
  const ctx: Ctx = {
    rgb: new Float32Array(n * 3),
    owner: new Uint8Array(n),
    paper: new Uint8Array(n),
    inPrint: new Uint8Array(n),
  };
  const digital = spec.digital;
  if (digital) {
    drawDigital(ctx, digital);
  } else {
    const at = backgroundAt(spec.bg, seed);
    const px: RGB = [0, 0, 0];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        at(x + 0.5, y + 0.5, px);
        const o = (y * WIDTH + x) * 3;
        ctx.rgb[o] = px[0];
        ctx.rgb[o + 1] = px[1];
        ctx.rgb[o + 2] = px[2];
      }
    }
    for (const shape of spec.shapes) fillShape(ctx, shape);
    for (const paper of spec.papers) drawPaper(ctx, paper);
    for (const cap of spec.occluders) fillCapsule(ctx, cap);
  }

  light(ctx.rgb, spec.light);
  let rgb = ctx.rgb;
  const cam = spec.camera;
  if (cam.defocus > 0) rgb = lineBlur(lineBlur(rgb, 1, 0, cam.defocus), 0, 1, cam.defocus);
  if (cam.motion) rgb = lineBlur(rgb, cam.motion.dx, cam.motion.dy, cam.motion.n);

  const full = new Uint8ClampedArray(n * 4);
  const noise = spec.light.noise;
  for (let i = 0; i < n; i++) {
    const luma = (rng() + rng() + rng() - 1.5) * 2 * noise;
    full[i * 4] = rgb[i * 3]! + luma + (rng() - 0.5) * noise * 0.6;
    full[i * 4 + 1] = rgb[i * 3 + 1]! + luma + (rng() - 0.5) * noise * 0.6;
    full[i * 4 + 2] = rgb[i * 3 + 2]! + luma + (rng() - 0.5) * noise * 0.6;
    full[i * 4 + 3] = 255;
  }
  if (cam.jpeg) jpegify(full);

  const rendered: Pixels = { data: full, width: WIDTH, height: HEIGHT };
  const pixels = cam.sample === "point" ? pointSample(rendered) : rendered;

  const paper = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
  const print = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
  for (let y = 0; y < MASK_HEIGHT; y++) {
    for (let x = 0; x < MASK_WIDTH; x++) {
      const i = y * 2 * WIDTH + x * 2;
      paper[y * MASK_WIDTH + x] = ctx.paper[i]!;
      print[y * MASK_WIDTH + x] = ctx.inPrint[i] && ctx.owner[i] === OWNER_MAIN ? 1 : 0;
    }
  }

  const main = spec.papers.find((p) => p.main);
  const frame: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const quad =
    digital || !main
      ? frame
      : (main.quad.map((p) => ({ x: p.x / WIDTH, y: p.y / HEIGHT })) as Quad);
  const sides = [0, 1, 2, 3].map((i): SideState => {
    if (digital || !main) return "visible";
    const a = main.quad[i]!;
    const b = main.quad[(i + 1) % 4]!;
    let inFrame = 0;
    let covered = 0;
    for (let k = 1; k <= 9; k++) {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const x = Math.floor(a.x + ((b.x - a.x) * k) / 10 - ((b.y - a.y) / len) * 3);
      const y = Math.floor(a.y + ((b.y - a.y) * k) / 10 + ((b.x - a.x) / len) * 3);
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
      inFrame++;
      if (ctx.owner[y * WIDTH + x] !== OWNER_MAIN) covered++;
    }
    if (inFrame < 5) return "off-frame";
    return covered * 2 > inFrame ? "covered" : "visible";
  }) as Truth["sides"];
  const cornersInFrame = quad.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  return {
    pixels,
    truth: {
      kind: digital ? "digital" : "paper",
      quad,
      cornersInFrame,
      expected: digital ? "none" : "crop",
      sides,
      paper,
      print,
      variant: spec.variant,
    },
  };
}
