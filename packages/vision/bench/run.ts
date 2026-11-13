import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { detectQuad } from "../src/detect/detect-quad";
import type { Pixels } from "../src/geometry";
import { CATEGORIES, SEED_SETS, renderCategoryScene, seedsFor, type SeedSet } from "./categories";
import { fingerprintScene, hex } from "./fingerprint";
import {
  compareToBaseline,
  cornerBars,
  encodeLevels,
  encodeOutcomes,
  levelAccuracy,
  scoreScene,
  summarise,
  weighted,
  type CategoryRecord,
  type CategoryStats,
  type SceneResult,
} from "./metrics";
import { MASK_HEIGHT, MASK_WIDTH, pointSample } from "./scene";

const BASELINE = new URL("./baseline.json", import.meta.url);

type Baseline = { set: SeedSet; firstSeed: number; scenes: number; categories: CategoryRecord[] };

function args() {
  const out = {
    set: "gate" as SeedSet,
    scenes: 0,
    category: "",
    write: false,
    force: false,
    check: false,
    timing: true,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--set") out.set = argv[++i] as SeedSet;
    else if (a === "--scenes") out.scenes = Number(argv[++i]);
    else if (a === "--category") out.category = argv[++i]!;
    else if (a === "--write-baseline") out.write = true;
    else if (a === "--force") out.force = true;
    else if (a === "--check") out.check = true;
    else if (a === "--no-timing") out.timing = false;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(out.set in SEED_SETS)) throw new Error("--set is tune, gate or holdout");
  if (!out.scenes) out.scenes = SEED_SETS[out.set].scenes;
  return out;
}

const pct = (v: number | null, digits = 0) => (v === null ? "-" : `${(v * 100).toFixed(digits)}%`);

function table(lines: string[][]) {
  const widths = lines[0]!.map((_, i) => Math.max(...lines.map((l) => l[i]!.length)));
  for (const l of lines) {
    console.log(
      l
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)))
        .join("  "),
    );
  }
}

const rates = (s: CategoryStats) => [pct(s.good), pct(s.loose), pct(s.miss), pct(s.harmful)];

function time(frames: Pixels[]) {
  for (const f of frames.slice(0, 30)) detectQuad(f);
  const ms = frames.map((f) => {
    const t = performance.now();
    detectQuad(f);
    return performance.now() - t;
  });
  ms.sort((a, b) => a - b);
  return { median: ms[Math.floor(ms.length / 2)]!, p95: ms[Math.floor(ms.length * 0.95)]! };
}

function bundleSize() {
  const entry = new URL("../src/detect/detect-quad.ts", import.meta.url).pathname;
  const code = execFileSync("bun", ["build", entry, "--minify", "--target", "browser"], {
    encoding: "utf8",
  });
  return { minified: Buffer.byteLength(code), gzipped: gzipSync(code).length };
}

function main() {
  const opts = args();
  const seeds = seedsFor(opts.set, opts.scenes);
  const picked = CATEGORIES.filter((c) => !opts.category || c.id === opts.category);
  if (!picked.length) throw new Error(`no category ${opts.category}`);

  const started = performance.now();
  const rows: {
    id: string;
    label: string;
    weight: number;
    results: SceneResult[];
    variants: string[];
    fingerprint: number;
  }[] = [];
  const frames: Pixels[] = [];
  for (const c of picked) {
    const row = {
      id: c.id,
      label: c.label,
      weight: c.weight,
      results: [] as SceneResult[],
      variants: [] as string[],
      fingerprint: 2166136261,
    };
    for (const seed of seeds) {
      const scene = renderCategoryScene(c.id, seed);
      row.results.push(scoreScene(scene.truth, detectQuad(scene.pixels)));
      row.variants.push(scene.truth.variant);
      row.fingerprint = fingerprintScene(scene, row.fingerprint);
      if (opts.timing) frames.push(pointSample(scene.pixels));
    }
    rows.push(row);
  }

  const stats = rows.map((r) => ({ ...r, stats: summarise(r.results) }));
  const all = weighted(stats);
  const every = summarise(rows.flatMap((r) => r.results));
  const header = [
    "Category",
    "Wt",
    "Good",
    "Loose",
    "Miss",
    "Harmful",
    "IoU",
    "Err med",
    "Err p90",
  ];
  table([
    header,
    ...stats.map((r) => [
      r.label,
      `${r.weight}%`,
      ...rates(r.stats),
      r.stats.meanIou === null ? "-" : r.stats.meanIou.toFixed(3),
      pct(r.stats.cornerMedian, 2),
      pct(r.stats.cornerP90, 2),
    ]),
    [
      "Weighted",
      "",
      pct(all.good, 1),
      pct(all.loose, 1),
      pct(all.miss, 1),
      pct(all.harmful, 1),
      every.meanIou === null ? "-" : every.meanIou.toFixed(3),
      pct(every.cornerMedian, 2),
      pct(every.cornerP90, 2),
    ],
  ]);

  console.log("\nBy variant");
  const variantLines = [["Category: variant", "n", "Good", "Loose", "Miss", "Harmful"]];
  for (const r of rows) {
    for (const v of [...new Set(r.variants)].sort()) {
      const s = summarise(r.results.filter((_, i) => r.variants[i] === v));
      variantLines.push([`${r.id}: ${v}`, String(s.n), ...rates(s)]);
    }
  }
  table(variantLines);

  const level = levelAccuracy(rows.flatMap((r) => r.results));
  console.log(
    `\nset ${opts.set} (seeds ${seeds[0]}..${seeds.at(-1)}), ${opts.scenes} scenes x ${rows.length} categories` +
      `\nlevel: ${level.applied} applied (${level.appliedHarmful} harmful), ${level.suggested} suggested (${level.suggestedGood} good)`,
  );
  if (opts.timing) {
    const t = time(frames);
    const size = bundleSize();
    console.log(
      `speed at ${MASK_WIDTH}x${MASK_HEIGHT}: median ${t.median.toFixed(1)} ms, p95 ${t.p95.toFixed(1)} ms`,
    );
    console.log(
      `size: ${(size.minified / 1024).toFixed(1)} kB minified, ${(size.gzipped / 1024).toFixed(1)} kB gzipped`,
    );
  }
  console.log(`run time ${((performance.now() - started) / 1000).toFixed(1)} s`);

  const current: CategoryRecord[] = rows.map((r) => ({
    id: r.id,
    weight: r.weight,
    fingerprint: hex(r.fingerprint),
    outcomes: encodeOutcomes(r.results),
    levels: encodeLevels(r.results),
  }));
  const baseline = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline)
    : null;

  if (opts.check || opts.write) {
    if (opts.set !== "gate") throw new Error("the baseline is on the gate set");
  }
  const problems = () => {
    if (!baseline) throw new Error("there is no baseline.json");
    return [...compareToBaseline(baseline.categories, current), ...cornerBars(rows)];
  };

  if (opts.write) {
    if (opts.category || opts.scenes !== SEED_SETS.gate.scenes) {
      throw new Error("the baseline is the full gate set");
    }
    if (baseline && !opts.force) {
      let found: string[];
      try {
        found = problems();
      } catch (error) {
        throw new Error(`${(error as Error).message}; rewrite the baseline with --force`);
      }
      if (found.length) {
        console.log(`\nrefusing to write a baseline that is worse:\n- ${found.join("\n- ")}`);
        console.log("pass --force to write it anyway");
        process.exitCode = 1;
        return;
      }
    }
    const next: Baseline = {
      set: "gate",
      firstSeed: SEED_SETS.gate.first,
      scenes: opts.scenes,
      categories: current,
    };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log("\nwrote baseline.json");
  }
  if (opts.check) {
    const found = problems();
    if (found.length) {
      console.log(`\nversus baseline:\n- ${found.join("\n- ")}`);
      process.exitCode = 1;
    } else console.log("\nversus baseline: no regression");
  }
}

main();
