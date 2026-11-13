import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { detectQuad } from "../src/detect/detect-quad";
import type { Pixels } from "../src/geometry";
import { CATEGORIES, SEED_SETS, renderCategoryScene, type SeedSet } from "./categories";
import {
  compareToBaseline,
  encodeOutcomes,
  levelAccuracy,
  scoreScene,
  summarise,
  weighted,
  type CategoryOutcomes,
  type SceneResult,
} from "./metrics";
import { MASK_HEIGHT, MASK_WIDTH, WIDTH } from "./scene";

const BASELINE = new URL("./baseline.json", import.meta.url);

type Baseline = { set: SeedSet; firstSeed: number; scenes: number; categories: CategoryOutcomes[] };

function args() {
  const out = {
    set: "gate" as SeedSet,
    scenes: 40,
    category: "",
    write: false,
    check: false,
    timing: true,
    verbose: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--set") out.set = argv[++i] as SeedSet;
    else if (a === "--scenes") out.scenes = Number(argv[++i]);
    else if (a === "--category") out.category = argv[++i]!;
    else if (a === "--write-baseline") out.write = true;
    else if (a === "--check") out.check = true;
    else if (a === "--no-timing") out.timing = false;
    else if (a === "--verbose") out.verbose = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(out.set in SEED_SETS)) throw new Error("--set is tune or gate");
  if (!Number.isInteger(out.scenes) || out.scenes < 1)
    throw new Error("--scenes is a positive integer");
  return out;
}

const pct = (v: number | null, digits = 0) => (v === null ? "-" : `${(v * 100).toFixed(digits)}%`);

/** The first pixel of each 2x2 block, the size the detector works at. */
function reduced(p: Pixels): Pixels {
  if (p.width !== WIDTH) return p;
  const data = new Uint8ClampedArray(MASK_WIDTH * MASK_HEIGHT * 4);
  for (let y = 0; y < MASK_HEIGHT; y++) {
    for (let x = 0; x < MASK_WIDTH; x++) {
      const s = (y * 2 * p.width + x * 2) * 4;
      data.set(p.data.subarray(s, s + 4), (y * MASK_WIDTH + x) * 4);
    }
  }
  return { data, width: MASK_WIDTH, height: MASK_HEIGHT };
}

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
  const firstSeed = SEED_SETS[opts.set];
  const picked = CATEGORIES.map((c, index) => ({ c, index })).filter(
    ({ c }) => !opts.category || c.id === opts.category,
  );
  if (!picked.length) throw new Error(`no category ${opts.category}`);

  const started = performance.now();
  const rows: { id: string; label: string; weight: number; results: SceneResult[] }[] = [];
  const frames: Pixels[] = [];
  for (const { c, index } of picked) {
    const results: SceneResult[] = [];
    for (let i = 0; i < opts.scenes; i++) {
      const scene = renderCategoryScene(index, firstSeed + i);
      const detection = detectQuad(scene.pixels);
      const result = scoreScene(scene.truth, detection);
      results.push(result);
      if (opts.timing) frames.push(reduced(scene.pixels));
      if (opts.verbose && result.outcome === "harmful") {
        console.log(`harmful: ${c.id} seed ${firstSeed + i} (${scene.truth.variant})`);
      }
    }
    rows.push({ id: c.id, label: c.label, weight: c.weight, results });
  }

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
  const lines = [header];
  const stats = rows.map((r) => ({ ...r, stats: summarise(r.results) }));
  for (const r of stats) {
    const s = r.stats;
    lines.push([
      r.label,
      `${r.weight}%`,
      pct(s.good),
      pct(s.loose),
      pct(s.miss),
      pct(s.harmful),
      s.meanIou === null ? "-" : s.meanIou.toFixed(3),
      pct(s.cornerMedian, 2),
      pct(s.cornerP90, 2),
    ]);
  }
  const all = weighted(stats);
  const every = summarise(rows.flatMap((r) => r.results));
  lines.push([
    "Weighted",
    "",
    pct(all.good, 1),
    pct(all.loose, 1),
    pct(all.miss, 1),
    pct(all.harmful, 1),
    every.meanIou === null ? "-" : every.meanIou.toFixed(3),
    pct(every.cornerMedian, 2),
    pct(every.cornerP90, 2),
  ]);
  const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i]!.length)));
  for (const l of lines) {
    console.log(
      l
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)))
        .join("  "),
    );
  }

  const level = levelAccuracy(rows.flatMap((r) => r.results));
  console.log(
    `\nset ${opts.set} (seeds ${firstSeed}..${firstSeed + opts.scenes - 1}), ${opts.scenes} scenes x ${rows.length} categories` +
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

  const current: CategoryOutcomes[] = rows.map((r) => ({
    id: r.id,
    weight: r.weight,
    outcomes: encodeOutcomes(r.results),
  }));
  if (opts.write) {
    if (opts.set !== "gate" || opts.category) throw new Error("the baseline is the full gate set");
    const baseline: Baseline = { set: "gate", firstSeed, scenes: opts.scenes, categories: current };
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log("wrote baseline.json");
  }
  if (opts.check) {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
    if (opts.set !== baseline.set) throw new Error("the baseline is on the gate set");
    const same = baseline.categories
      .filter((b) => current.some((c) => c.id === b.id))
      .map((b) => ({ ...b, outcomes: b.outcomes.slice(0, opts.scenes) }));
    const problems = compareToBaseline(same, current);
    if (problems.length) {
      console.log(`\nversus baseline:\n- ${problems.join("\n- ")}`);
      process.exitCode = 1;
    } else console.log("\nversus baseline: no regression");
  }
}

main();
