import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.x contrast for the token pairs the UI relies on, in both themes. Tints (`bg-primary/15`)
// are painted over a surface, so they are alpha-composited in sRGB, as the browser does.
const css = readFileSync(path.join(import.meta.dirname, "../src/styles.css"), "utf8");

type Rgb = [number, number, number];
type Theme = Record<string, string>;

function block(selector: string): Theme {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in styles.css`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

const dark = block(":root,\n.dark");
const light: Theme = { ...dark, ...block(":root.light") };

function parse(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) as Rgb;
  throw new Error(`not a hex colour: ${value}`);
}

function color(theme: Theme, token: string, over?: string): Rgb {
  const [name, alpha] = token.split("/");
  const rgb = parse(theme[name!] ?? "");
  if (!alpha) return rgb;
  const base = color(theme, over ?? "card");
  const a = Number(alpha) / 100;
  return rgb.map((c, i) => c * a + base[i]! * (1 - a)) as Rgb;
}

function luminance([r, g, b]: Rgb) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [text or UI token, surface token, minimum]. A surface like `primary/15` is that tint over --card.
type Pair = [string, string, number];

const TEXT = 4.5;
const UI = 3;
const SURFACES = ["background", "card", "muted"];

const shared: Pair[] = [
  ...SURFACES.map((s): Pair => ["foreground", s, TEXT]),
  ...SURFACES.map((s): Pair => ["muted-foreground", s, TEXT]),
  ["muted-foreground", "accent", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["primary", "card", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["success", "card", TEXT],
  ["success-foreground", "success", TEXT],
  ["warning", "card", TEXT],
  ["warning-foreground", "warning", TEXT],
  ["destructive", "card", TEXT],
  ["destructive-foreground", "destructive", TEXT],
  ["info", "card", TEXT],
  ["info-foreground", "info", TEXT],
  ["cta-foreground", "cta", TEXT],
  ["cta-foreground", "cta-hover", TEXT],
  ["input", "card", UI],
  ["input", "background", UI],
  ["ring", "background", UI],
  ["ring", "card", UI],
  ...["green", "teal", "blue", "violet", "pink", "red", "orange", "yellow"].flatMap((g): Pair[] => [
    [`group-${g}`, "card", UI],
    [`group-${g}`, "popover", UI],
  ]),
];

// Light also clears the tinted chips and rows, and the gradient stops.
const lightOnly: Pair[] = [
  ["primary", "background", TEXT],
  ["primary", "primary/10", TEXT],
  ["primary", "primary/15", TEXT],
  ["muted-foreground", "primary/15", TEXT],
  ["warning", "background", TEXT],
  ["warning", "warning/10", TEXT],
  ["warning", "warning/5", TEXT],
  ["destructive", "background", TEXT],
  ["destructive", "destructive/10", TEXT],
  ["destructive", "destructive/20", TEXT],
  ["brand-teal", "card", TEXT],
  ["brand-cyan", "card", TEXT],
];

function failures(theme: Theme, pairs: Pair[]) {
  return pairs
    .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(color(theme, fg), color(theme, bg)) }))
    .filter((p) => p.ratio < p.min)
    .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}`);
}

describe("theme contrast", () => {
  it("dark tokens clear AA for every pair", () => {
    expect(failures(dark, shared)).toEqual([]);
  });

  it("light tokens clear AA for every pair, tints included", () => {
    expect(failures(light, [...shared, ...lightOnly])).toEqual([]);
  });

  it("light overrides every dark colour token", () => {
    // --radius, --cta* and --wash* are shared on purpose (theme-neutral or derived).
    const shared = /^(radius|cta|cta-hover|cta-foreground|wash|wash-subtle)$/;
    const missing = Object.keys(dark).filter(
      (k) => !shared.test(k) && !(k in block(":root.light")),
    );
    expect(missing).toEqual([]);
  });

  it("matches published reference ratios", () => {
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast(parse("#036c4d"), parse("#ffffff"))).toBeCloseTo(6.45, 1);
  });
});
