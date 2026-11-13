import type { Point, Quad } from "../src/geometry";
import { between, chance, gauss, hash3, mulberry32, pick, type Rng } from "./rng";
import {
  HEIGHT,
  WIDTH,
  renderScene,
  type Background,
  type Camera,
  type Capsule,
  type Light,
  type PaperSpec,
  type RGB,
  type Scene,
  type SceneSpec,
  type Shape,
} from "./scene";

export type Category = {
  id: string;
  label: string;
  /** Share of real captures, assumed (no study publishes this mix); weights are normalised when combined. */
  weight: number;
  /** `slot` is the scene's seed, so consecutive seeds rotate through a category's variants evenly. */
  spec: (r: Rng, slot: number) => SceneSpec;
};

const SKIN: RGB[] = [
  [236, 188, 160],
  [224, 172, 140],
  [198, 134, 100],
  [160, 106, 78],
  [121, 80, 58],
  [92, 60, 44],
];

const variantOf = <T>(slot: number, list: readonly T[]): T => list[slot % list.length]!;

const grey = (v: number): RGB => [v, v, v];
const tint = (r: Rng, base: RGB, spread: number): RGB => [
  base[0] + gauss(r, spread),
  base[1] + gauss(r, spread),
  base[2] + gauss(r, spread),
];

const paperTone = (r: Rng): RGB =>
  tint(
    r,
    pick(r, [
      [238, 236, 230],
      [232, 230, 222],
      [244, 243, 240],
    ] as RGB[]),
    3,
  );

/** Corners of a receipt `h` px tall and `h / aspect` wide, turned by `angle` degrees, with keystone and corner jitter. */
function makeQuad(
  r: Rng,
  cx: number,
  cy: number,
  h: number,
  aspect: number,
  angle: number,
  jitter = 0.02,
): Quad {
  const w = h / aspect;
  const keystone = gauss(r, 0.04);
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([lx, ly]) => {
    const kx = lx * (1 + keystone * (ly / h) * 2) + gauss(r, jitter * w);
    const ky = ly + gauss(r, jitter * w);
    return { x: cx + kx * cos - ky * sin, y: cy + kx * sin + ky * cos };
  }) as Quad;
}

/** Scales a quad about its centre until it fits the frame with `margin` px to spare, then shifts it inside. */
function fitInFrame(q: Quad, margin = 8, maxBottom = HEIGHT - margin): Quad {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const s = Math.min(1, (WIDTH - 2 * margin) / w, (maxBottom - margin) / h);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const scaled = q.map((p) => ({ x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s }));
  const x0 = Math.min(...scaled.map((p) => p.x));
  const x1 = Math.max(...scaled.map((p) => p.x));
  const y0 = Math.min(...scaled.map((p) => p.y));
  const y1 = Math.max(...scaled.map((p) => p.y));
  const dx = x0 < margin ? margin - x0 : x1 > WIDTH - margin ? WIDTH - margin - x1 : 0;
  const dy = y0 < margin ? margin - y0 : y1 > maxBottom ? maxBottom - y1 : 0;
  return scaled.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
}

function paper(r: Rng, quad: Quad, extra: Partial<PaperSpec> = {}): PaperSpec {
  return {
    quad,
    main: true,
    tone: paperTone(r),
    inkColor: grey(between(r, 30, 70)),
    ink: between(r, 0.7, 0.9),
    seed: Math.floor(r() * 1e6),
    bows: [0, 0, 0, 0],
    creases: [],
    curl: 0,
    ...extra,
  };
}

function dropShadow(r: Rng, q: Quad, strength = between(r, 0.12, 0.35)): Shape {
  const dx = between(r, -4, 6);
  const dy = between(r, 2, 8);
  return {
    pts: q.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    color: [0, 0, 0],
    alpha: strength,
    soft: between(r, 2, 6),
  };
}

function baseLight(r: Rng): Light {
  return { gain: between(r, 0.9, 1.05), vignette: between(r, 0, 0.25), noise: between(r, 1, 3) };
}

function baseCamera(r: Rng): Camera {
  return {
    defocus: chance(r, 0.25) ? 1 : 0,
    sample: chance(r, 0.5) ? "area" : "point",
    jpeg: false,
  };
}

const motionBlur = (r: Rng): Camera["motion"] => ({
  dx: pick(r, [1, 0, 0.7]),
  dy: pick(r, [0, 1, 0.7]),
  n: Math.floor(between(r, 3, 7)),
});

function darkTable(r: Rng): Background {
  if (chance(r, 0.5)) return { kind: "flat", color: tint(r, grey(between(r, 25, 70)), 3) };
  return {
    kind: "wood",
    color: tint(
      r,
      pick(r, [
        [96, 66, 40],
        [70, 48, 30],
        [124, 88, 56],
      ] as RGB[]),
      6,
    ),
    angle: between(r, 0, Math.PI),
    freq: between(r, 0.15, 0.4),
    contrast: between(r, 0.08, 0.2),
  };
}

const LIGHT_SURFACES = ["white desk", "bed sheet", "light wood"] as const;

function lightSurface(
  r: Rng,
  kind: (typeof LIGHT_SURFACES)[number] = pick(r, LIGHT_SURFACES),
): Background {
  const v = between(r, 225, 250);
  if (kind === "white desk") return { kind: "flat", color: tint(r, [v, v - 2, v - 6], 2) };
  if (kind === "bed sheet") return { kind: "sheet", color: tint(r, [v, v, v + 2], 2) };
  return {
    kind: "wood",
    color: tint(r, [206, 170, 126], 8),
    angle: between(r, 0, Math.PI),
    freq: between(r, 0.12, 0.3),
    contrast: between(r, 0.05, 0.12),
  };
}

const PATTERNED = ["check", "denim", "fabric", "seat", "dashboard"] as const;

function patternedSurface(
  r: Rng,
  kind: (typeof PATTERNED)[number] = pick(r, PATTERNED),
): { bg: Background; shapes: Shape[]; variant: string } {
  if (kind === "check") {
    const a = tint(
      r,
      pick(r, [
        [180, 40, 40],
        [60, 90, 150],
        [200, 190, 160],
      ] as RGB[]),
      6,
    );
    return {
      bg: {
        kind: "check",
        a,
        b: grey(between(r, 190, 235)),
        cell: between(r, 14, 30),
        angle: between(r, 0, 1.5),
      },
      shapes: [],
      variant: "check cloth",
    };
  }
  if (kind === "denim")
    return { bg: { kind: "twill", color: tint(r, [64, 84, 122], 6) }, shapes: [], variant: "lap" };
  if (kind === "fabric")
    return {
      bg: { kind: "fabric", color: tint(r, grey(between(r, 30, 80)), 6) },
      shapes: [],
      variant: "dark fabric",
    };
  if (kind === "dashboard") {
    const a = between(r, -0.08, 0.08);
    return {
      bg: { kind: "fabric", color: grey(between(r, 24, 38)) },
      shapes: [
        {
          pts: rect(WIDTH / 2, HEIGHT * 0.2, 520, 150, a),
          color: grey(between(r, 62, 84)),
          alpha: 1,
        },
        {
          pts: rect(WIDTH / 2, HEIGHT * 0.34, 520, 8, a),
          color: grey(between(r, 150, 180)),
          alpha: 1,
        },
        {
          pts: rect(WIDTH / 2, HEIGHT * 0.9, 300, 110, a),
          color: grey(between(r, 52, 70)),
          alpha: 1,
        },
      ],
      variant: "dashboard",
    };
  }
  const stitches: Shape[] = [];
  const pitch = between(r, 70, 110);
  for (let y = between(r, 0, pitch); y < HEIGHT; y += pitch) {
    stitches.push({
      pts: [
        { x: 0, y },
        { x: WIDTH, y },
        { x: WIDTH, y: y + 2.5 },
        { x: 0, y: y + 2.5 },
      ],
      color: grey(130),
      alpha: 0.7,
    });
  }
  return {
    bg: { kind: "fabric", color: grey(between(r, 22, 40)) },
    shapes: stitches,
    variant: "car seat",
  };
}

const rect = (cx: number, cy: number, w: number, h: number, angle: number): Point[] => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ] as const
  ).map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
};

function keyboard(r: Rng, lightKeys: boolean): Shape[] {
  const angle = between(r, -0.2, 0.2);
  const shapes: Shape[] = [
    { pts: rect(WIDTH / 2, HEIGHT / 2, 700, 700, angle), color: grey(20), alpha: 1 },
  ];
  const key = lightKeys ? grey(between(r, 205, 235)) : grey(between(r, 30, 55));
  const cw = between(r, 32, 40);
  const ch = between(r, 28, 34);
  for (let row = -8; row <= 8; row++) {
    for (let col = -8; col <= 8; col++) {
      const x = WIDTH / 2 + col * (cw + 4);
      const y = HEIGHT / 2 + row * (ch + 4);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = WIDTH / 2 + (x - WIDTH / 2) * cos - (y - HEIGHT / 2) * sin;
      const ry = HEIGHT / 2 + (x - WIDTH / 2) * sin + (y - HEIGHT / 2) * cos;
      if (rx < -50 || rx > WIDTH + 50 || ry < -50 || ry > HEIGHT + 50) continue;
      shapes.push({ pts: rect(rx, ry, cw, ch, angle), color: tint(r, key, 4), alpha: 1 });
    }
  }
  return shapes;
}

const CLUTTER = ["keyboard light", "keyboard dark", "papers", "laptop", "objects"] as const;

function clutter(
  r: Rng,
  avoid: Quad,
  kind: (typeof CLUTTER)[number],
): { bg: Background; shapes: Shape[]; variant: string } {
  const bg: Background = chance(r, 0.5) ? darkTable(r) : lightSurface(r);
  if (kind === "keyboard light" || kind === "keyboard dark") {
    return { bg, shapes: keyboard(r, kind === "keyboard light"), variant: kind };
  }
  const cx = avoid.reduce((s, p) => s + p.x, 0) / 4;
  const cy = avoid.reduce((s, p) => s + p.y, 0) / 4;
  const shapes: Shape[] = [];
  if (kind === "laptop") {
    shapes.push({ pts: rect(WIDTH / 2, HEIGHT / 2, 700, 700, 0), color: grey(60), alpha: 1 });
    shapes.push({
      pts: rect(WIDTH / 2, HEIGHT * 0.88, 260, 120, 0),
      color: grey(between(r, 170, 200)),
      alpha: 1,
    });
  }
  const count = Math.floor(between(r, 6, 12));
  for (let i = 0; i < count; i++) {
    const w = between(r, 40, 150);
    const h = between(r, 40, 150);
    const white = kind === "papers" ? chance(r, 0.7) : chance(r, 0.25);
    const color: RGB = white
      ? tint(r, grey(between(r, 215, 245)), 3)
      : tint(
          r,
          pick(r, [
            [40, 40, 44],
            [150, 60, 50],
            [70, 100, 140],
            [120, 120, 118],
          ] as RGB[]),
          8,
        );
    shapes.push({
      pts: rect(cx + gauss(r, 150), cy + gauss(r, 150), w, h, between(r, -0.5, 0.5)),
      color,
      alpha: 1,
    });
  }
  return { bg, shapes, variant: kind };
}

function room(r: Rng, wall?: RGB): { bg: Background; shapes: Shape[] } {
  const horizon = HEIGHT * between(r, 0.62, 0.82);
  const wallColor =
    wall ??
    tint(
      r,
      pick(r, [
        [196, 188, 176],
        [150, 160, 170],
        [225, 220, 210],
        [110, 100, 92],
      ] as RGB[]),
      5,
    );
  const shapes: Shape[] = [
    {
      pts: [
        { x: -10, y: horizon },
        { x: WIDTH + 10, y: horizon },
        { x: WIDTH + 10, y: HEIGHT + 10 },
        { x: -10, y: HEIGHT + 10 },
      ],
      color: tint(r, [120, 92, 66], 8),
      alpha: 1,
    },
  ];
  const dw = between(r, 80, 130);
  const dx = between(r, 20, WIDTH - dw - 20);
  shapes.push({
    pts: rect(dx + dw / 2, horizon / 2 + 10, dw, horizon - 20, 0),
    color: tint(r, [90, 66, 48], 8),
    alpha: 1,
  });
  if (chance(r, 0.3)) {
    shapes.push({
      pts: rect(
        between(r, 60, 320),
        between(r, 40, 140),
        between(r, 60, 120),
        between(r, 50, 100),
        0,
      ),
      color: [236, 240, 246],
      alpha: 1,
    });
  }
  return { bg: { kind: "flat", color: wallColor }, shapes };
}

/** The point on side `side` of `q` at fraction `t`, and the unit vector pointing out of the quad there. */
function onSide(q: Quad, side: number, t: number) {
  const a = q[side]!;
  const b = q[(side + 1) % 4]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return {
    p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    out: { x: (b.y - a.y) / len, y: -(b.x - a.x) / len },
    tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
    len,
  };
}

function fingers(r: Rng, q: Quad, side: number, count: number, skin: RGB): Capsule[] {
  const { len } = onSide(q, side, 0);
  const radius = between(r, 11, 17);
  const centre = between(r, 0.35, 0.65);
  const depth = between(r, 0.05, 0.14) * len;
  const slant = between(r, -0.3, 0.3);
  return Array.from({ length: count }, (_, k) => {
    const t = centre + (k - (count - 1) / 2) * ((radius * 2.15) / len);
    const { p, out, tangent } = onSide(q, side, t);
    return {
      a: { x: p.x - out.x * depth, y: p.y - out.y * depth },
      b: { x: p.x + (out.x + tangent.x * slant) * 220, y: p.y + (out.y + tangent.y * slant) * 220 },
      r: radius,
      color: tint(r, skin, 3),
    };
  });
}

function sleeve(r: Rng, q: Quad, side: number): Capsule {
  const { p, out } = onSide(q, side, 0.5);
  return {
    a: { x: p.x + out.x * 70, y: p.y + out.y * 70 },
    b: { x: p.x + out.x * 400, y: p.y + out.y * 400 },
    r: between(r, 38, 55),
    color: tint(
      r,
      pick(r, [
        [40, 60, 90],
        [150, 40, 40],
        [60, 60, 60],
        [200, 200, 205],
      ] as RGB[]),
      5,
    ),
  };
}

function plainSpec(
  r: Rng,
  variant: string,
  bg: Background,
  quad: Quad,
  extra: Partial<SceneSpec> = {},
): SceneSpec {
  return {
    variant,
    bg,
    shapes: [dropShadow(r, quad)],
    papers: [paper(r, quad)],
    occluders: [],
    light: baseLight(r),
    camera: baseCamera(r),
    ...extra,
  };
}

const tableQuad = (r: Rng) =>
  fitInFrame(
    makeQuad(
      r,
      between(r, 150, 234),
      between(r, 200, 312),
      between(r, 260, 420),
      between(r, 1.3, 2.3),
      gauss(r, 14),
    ),
  );

export const CATEGORIES: Category[] = [
  {
    id: "table",
    label: "Flat on a contrasting table, dark/wood",
    weight: 18,
    spec: (r) => {
      const q = tableQuad(r);
      return plainSpec(r, "table", darkTable(r), q);
    },
  },
  {
    id: "hand",
    label: "Hand-held, room behind, fingers on it",
    weight: 15,
    spec: (r, slot) => {
      const variant = variantOf(slot, ["room", "white wall", "sleeve"] as const);
      const q = fitInFrame(
        makeQuad(
          r,
          between(r, 160, 224),
          between(r, 180, 260),
          between(r, 260, 380),
          between(r, 1.3, 2.2),
          gauss(r, 8),
        ),
        10,
        HEIGHT * 0.84,
      );
      const { bg, shapes } = room(
        r,
        variant === "white wall" ? grey(between(r, 228, 246)) : undefined,
      );
      const skin = pick(r, SKIN);
      const occluders = fingers(r, q, 2, Math.floor(between(r, 2, 4)), skin);
      if (chance(r, 0.4)) occluders.push(...fingers(r, q, chance(r, 0.5) ? 1 : 3, 1, skin));
      if (variant === "sleeve") occluders.unshift(sleeve(r, q, 2));
      return {
        variant,
        bg,
        shapes,
        papers: [paper(r, q)],
        occluders,
        light: baseLight(r),
        camera: { ...baseCamera(r), motion: chance(r, 0.2) ? motionBlur(r) : undefined },
      };
    },
  },
  {
    id: "thumb",
    label: "Hand-held, thumb over a corner",
    weight: 4,
    spec: (r, slot) => {
      const onTable = slot % 5 < 2;
      const q = fitInFrame(
        makeQuad(
          r,
          between(r, 170, 214),
          between(r, 190, 270),
          between(r, 260, 380),
          between(r, 1.3, 2.2),
          gauss(r, 8),
        ),
        14,
      );
      const corner = Math.floor(r() * 4);
      const c = q[corner]!;
      const mid = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
      const d = Math.hypot(c.x - mid.x, c.y - mid.y) || 1;
      const out = { x: (c.x - mid.x) / d, y: (c.y - mid.y) / d };
      const radius = between(r, 11, 16);
      const thumb: Capsule = {
        a: { x: c.x - out.x * radius * 0.5, y: c.y - out.y * radius * 0.5 },
        b: { x: c.x + out.x * 240, y: c.y + out.y * 240 },
        r: radius,
        color: tint(r, pick(r, SKIN), 3),
      };
      const scene = onTable ? { bg: darkTable(r), shapes: [dropShadow(r, q)] } : room(r);
      return {
        variant: onTable ? "table" : "room",
        ...scene,
        papers: [paper(r, q)],
        occluders: [thumb],
        light: baseLight(r),
        camera: baseCamera(r),
      };
    },
  },
  {
    id: "white",
    label: "White or light surface",
    weight: 10,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const variant = variantOf(slot, [...LIGHT_SURFACES, "darker receipt"] as const);
      const darker = variant === "darker receipt";
      const bg = darker ? lightSurface(r, "white desk") : lightSurface(r, variant);
      const spec = plainSpec(r, variant, bg, q);
      if (darker)
        spec.papers = [paper(r, q, { tone: grey(between(r, 188, 208)), inkColor: grey(40) })];
      return spec;
    },
  },
  {
    id: "clutter",
    label: "Messy desk, keyboard, clutter",
    weight: 7,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const { bg, shapes, variant } = clutter(r, q, variantOf(slot, CLUTTER));
      return plainSpec(r, variant, bg, q, { shapes: [...shapes, dropShadow(r, q)] });
    },
  },
  {
    id: "patterned",
    label: "Patterned cloth, lap, car seat",
    weight: 7,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const { bg, shapes, variant } = patternedSurface(r, variantOf(slot, PATTERNED));
      return plainSpec(r, variant, bg, q, { shapes: [...shapes, dropShadow(r, q)] });
    },
  },
  {
    id: "thermal",
    label: "Long thermal, 1:3.5 to 1:5.5",
    weight: 6,
    spec: (r, slot) => {
      const q = fitInFrame(
        makeQuad(
          r,
          between(r, 170, 214),
          between(r, 230, 282),
          between(r, 300, 440),
          between(r, 3.5, 5.5),
          gauss(r, 9),
          0.015,
        ),
      );
      const onPattern = slot % 4 === 3;
      return plainSpec(
        r,
        onPattern ? "thermal on pattern" : "thermal",
        onPattern ? patternedSurface(r).bg : darkTable(r),
        q,
      );
    },
  },
  {
    id: "crumpled",
    label: "Crumpled or curled",
    weight: 5,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const curled = slot % 5 >= 3;
      const bow = () => between(r, 0.005, 0.03);
      const creases = Array.from({ length: Math.floor(between(r, 4, 9)) }, () => {
        const a = between(r, 0, Math.PI);
        return {
          nu: Math.cos(a),
          nv: Math.sin(a),
          offset: between(r, 0.1, 0.9),
          depth: between(r, 0.03, 0.1),
          width: between(r, 0.008, 0.03),
        };
      });
      const spec = plainSpec(r, curled ? "curled" : "crumpled", darkTable(r), q);
      spec.papers = [
        paper(r, q, {
          creases,
          bows: curled
            ? [-0.01, bow(), -0.01, bow()]
            : [bow() * gauss(r, 1.5), bow(), bow(), bow() * gauss(r, 1.5)],
          curl: curled ? between(r, 0.08, 0.2) : 0,
        }),
      ];
      return spec;
    },
  },
  {
    id: "folded",
    label: "Folded",
    weight: 2,
    spec: (r) => {
      const q = tableQuad(r);
      const spec = plainSpec(r, "folded", darkTable(r), q);
      spec.papers = [
        paper(r, q, { fold: { v: between(r, 0.3, 0.7), step: between(r, 0.88, 0.97) } }),
      ];
      return spec;
    },
  },
  {
    id: "shadow",
    label: "Shadow across the paper",
    weight: 5,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const bg = slot % 5 < 3 ? darkTable(r) : lightSurface(r);
      const spec = plainSpec(r, "shadow", bg, q);
      const mid = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
      if (slot % 3 !== 2) {
        const a = between(r, 0, Math.PI * 2);
        spec.light.shadow = {
          kind: "half",
          nx: Math.cos(a),
          ny: Math.sin(a),
          offset: Math.cos(a) * mid.x + Math.sin(a) * mid.y + between(r, -50, 50),
          soft: between(r, 6, 40),
          strength: between(r, 0.25, 0.5),
        };
      } else {
        spec.variant = "phone shadow";
        spec.light.shadow = {
          kind: "blob",
          cx: mid.x + gauss(r, 40),
          cy: mid.y + gauss(r, 60),
          rx: between(r, 60, 130),
          ry: between(r, 80, 180),
          strength: between(r, 0.25, 0.5),
        };
      }
      return spec;
    },
  },
  {
    id: "lowlight",
    label: "Low light and noise",
    weight: 4,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const spec = plainSpec(r, "low light", darkTable(r), q);
      spec.light = {
        gain: between(r, 0.25, 0.5),
        vignette: between(r, 0.1, 0.4),
        noise: between(r, 5, 11),
      };
      if (slot % 3 === 2) {
        spec.variant = "motion blur";
        spec.camera.motion = motionBlur(r);
      }
      return spec;
    },
  },
  {
    id: "glare",
    label: "Glare, or a light band beside the paper",
    weight: 2,
    spec: (r, slot) => {
      const q = tableQuad(r);
      const spec = plainSpec(r, "glare", darkTable(r), q);
      if (slot % 2 === 0) {
        const mid = onSide(q, 1, 0.5).p;
        spec.light.glare = {
          x: mid.x + gauss(r, 30),
          y: mid.y + gauss(r, 60),
          sigma: between(r, 25, 55),
          strength: between(r, 0.3, 0.6),
        };
      } else {
        spec.variant = "light band";
        const side = pick(r, [1, 3]);
        const { len } = onSide(q, side, 0);
        const w = between(r, 0.06, 0.14) * len;
        const gap = between(r, 0, 3);
        const a = q[side]!;
        const b = q[(side + 1) % 4]!;
        const { out } = onSide(q, side, 0.5);
        const at = (p: Point, k: number) => ({ x: p.x + out.x * k, y: p.y + out.y * k });
        spec.shapes = [
          {
            pts: [at(a, gap), at(b, gap), at(b, gap + w), at(a, gap + w)],
            color: tint(r, grey(between(r, 175, 215)), 3),
            alpha: 1,
          },
          ...spec.shapes,
        ];
      }
      return spec;
    },
  },
  {
    id: "partial",
    label: "Partial, runs off the frame",
    weight: 5,
    spec: (r) => {
      const h = between(r, 480, 640);
      const side = pick(r, [-1, 1]);
      const q = makeQuad(
        r,
        WIDTH / 2 + side * between(r, 10, 60),
        between(r, 230, 300),
        h,
        between(r, 1.4, 2),
        gauss(r, 8),
      );
      return plainSpec(r, "partial", darkTable(r), q);
    },
  },
  {
    id: "several",
    label: "Several or overlapping receipts",
    weight: 2,
    spec: (r, slot) => {
      const mode = variantOf(slot, ["separate", "close", "under", "over"] as const);
      const gap =
        mode === "separate"
          ? between(r, 30, 50)
          : mode === "close"
            ? between(r, 0, 8)
            : -between(r, 20, 60);
      const hMain = between(r, 220, 290);
      const hOther = between(r, 200, 280);
      const wMain = hMain / 2;
      const wOther = hOther / 2;
      const left = (WIDTH - (wMain + wOther + gap)) / 2;
      const cx = left + wMain / 2;
      const main = makeQuad(r, cx, between(r, 220, 290), hMain, 2, gauss(r, 6));
      const other = makeQuad(
        r,
        cx + wMain / 2 + gap + wOther / 2,
        between(r, 200, 310),
        hOther,
        2,
        gauss(r, 6),
      );
      const spec = plainSpec(r, mode, darkTable(r), main);
      const second = paper(r, other, { main: false });
      spec.papers = mode === "over" ? [spec.papers[0]!, second] : [second, spec.papers[0]!];
      spec.shapes = [dropShadow(r, other), dropShadow(r, main)];
      return spec;
    },
  },
  {
    id: "a4",
    label: "A4 invoice on a desk",
    weight: 4,
    spec: (r) => {
      const q = fitInFrame(
        makeQuad(
          r,
          between(r, 180, 204),
          between(r, 240, 272),
          between(r, 340, 450),
          1.414,
          gauss(r, 8),
          0.012,
        ),
      );
      const bg = chance(r, 0.7) ? darkTable(r) : patternedSurface(r).bg;
      return plainSpec(r, "a4", bg, q);
    },
  },
  {
    id: "digital",
    label: "Screenshot or PDF render, no edges",
    weight: 5,
    spec: (r, slot) => {
      const variant = variantOf(slot, [
        "light",
        "dark mode",
        "status bar",
        "jpeg",
        "card",
        "app bar",
        "card on dark",
        "dark bars",
      ] as const);
      const dark = variant === "dark mode";
      const inset =
        variant === "card" || variant === "card on dark" ? Math.floor(between(r, 16, 40)) : 0;
      return {
        variant,
        bg: { kind: "flat", color: grey(255) },
        shapes: [],
        papers: [],
        occluders: [],
        light: { gain: 1, vignette: 0, noise: 0 },
        camera: { defocus: 0, sample: "area", jpeg: variant === "jpeg" },
        digital: {
          page: dark ? grey(between(r, 14, 30)) : grey(between(r, 246, 255)),
          inkColor: dark ? grey(225) : grey(between(r, 20, 50)),
          margin: between(r, 0.08, 0.22) + inset / WIDTH,
          chrome: variant === "status bar" ? 24 : 0,
          bar:
            variant === "app bar"
              ? { height: Math.floor(between(r, 36, 64)), color: tint(r, [30, 110, 90], 15) }
              : variant === "dark bars"
                ? { height: 24, color: grey(between(r, 16, 30)) }
                : undefined,
          navBar:
            variant === "dark bars" ? { height: 48, color: grey(between(r, 16, 30)) } : undefined,
          card: inset
            ? {
                inset,
                backdrop: grey(variant === "card" ? between(r, 225, 240) : between(r, 16, 40)),
              }
            : undefined,
          seed: Math.floor(r() * 1e6),
        },
      };
    },
  },
];

/**
 * Seed pools. `tune` is for choosing thresholds, `gate` is the per-PR check, `holdout` is never tuned against and is
 * run when the detector is rewritten. The pools do not overlap at their caps.
 */
export const SEED_SETS = {
  tune: { first: 1000, max: 1000, scenes: 10 },
  gate: { first: 5000, max: 1000, scenes: 40 },
  holdout: { first: 9000, max: 1000, scenes: 200 },
} as const;
export type SeedSet = keyof typeof SEED_SETS;

/** The seeds of `count` scenes per category from a pool; throws past the pool's cap. */
export function seedsFor(set: SeedSet, count: number): number[] {
  const pool = SEED_SETS[set];
  if (!Number.isInteger(count) || count < 1 || count > pool.max) {
    throw new Error(`${set} holds 1 to ${pool.max} scenes per category`);
  }
  return Array.from({ length: count }, (_, i) => pool.first + i);
}

const idHash = (id: string) => [...id].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 7) | 0;

/** Seeded by the category id, so reordering or adding categories leaves existing scenes alone. */
export function renderCategoryScene(categoryId: string, seed: number): Scene {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) throw new Error(`no category ${categoryId}`);
  const sceneSeed = Math.floor(hash3(idHash(categoryId), seed, 0x5eed) * 2 ** 31);
  return renderScene(category.spec(mulberry32(sceneSeed), seed), sceneSeed);
}
