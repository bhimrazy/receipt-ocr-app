// Measures the browser image shrinker (apps/web/lib/upload-prep.ts) in headless Chromium.
//   bun bench/encode.mjs        (needs `bunx playwright install chromium`)
// Inputs: the bench/fixtures PNGs plus synthetic noisy photos, including tall thermal receipts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.join(import.meta.dirname, "..");
const built = await Bun.build({
  entrypoints: [path.join(root, "apps/web/lib/upload-prep.ts")],
  target: "browser",
  format: "esm",
});
if (!built.success) throw new Error("bundle failed");
const script = await built.outputs[0].text();

const fixtures = readdirSync(path.join(root, "bench/fixtures"))
  .filter((f) => f.endsWith(".png"))
  .map((f) => ({
    name: f,
    base64: readFileSync(path.join(root, "bench/fixtures", f)).toString("base64"),
  }));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body></body>");
await page.addScriptTag({
  type: "module",
  content: `${script}\nwindow.prep = { jpegEncoder, planSize, encodeToTarget, prepareFile };`,
});
await page.waitForFunction(() => window.prep);

const rows = await page.evaluate(async (fixtures) => {
  const { jpegEncoder, planSize, encodeToTarget, prepareFile } = window.prep;
  // Seeded noise so runs are repeatable.
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  // A paper-textured receipt photo: speckle noise plus lines of text, saved as a camera-quality JPEG.
  async function synthetic(name, w, h, type = "image/jpeg") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, w, h);
    const tile = ctx.createImageData(256, 256);
    for (let i = 0; i < tile.data.length; i += 4) {
      const v = 200 + rand() * 55;
      tile.data.set([v, v, v - 6, 38], i);
    }
    const t = new OffscreenCanvas(256, 256);
    t.getContext("2d").putImageData(tile, 0, 0);
    ctx.fillStyle = ctx.createPattern(t, "repeat");
    ctx.fillRect(0, 0, w, h);
    const font = Math.round(w / 40);
    ctx.fillStyle = "#222";
    ctx.font = `${font}px monospace`;
    for (let y = font * 2, n = 0; y < h - font; y += font * 1.5, n++) {
      let line = "";
      for (let k = 0; k < 34; k++)
        line += "ABCDEFGHJKLMNPRSTUVWXYZ0123456789.,"[Math.floor(rand() * 36)];
      ctx.fillText(line, w * 0.06, y);
    }
    const blob = await c.convertToBlob({ type, quality: 0.92 });
    return new File([blob], name, { type });
  }
  const files = [];
  for (const f of fixtures) {
    const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
    files.push(new File([bytes], f.name, { type: "image/png" }));
  }
  files.push(
    await synthetic("phone-12mp.jpg", 3024, 4032),
    await synthetic("tall-1x4-1200.jpg", 1200, 4800),
    await synthetic("tall-1x6-1500.jpg", 1500, 9000),
    await synthetic("tall-1x6-800.jpg", 800, 4800),
    await synthetic("small-640.jpg", 640, 960),
  );
  const out = [];
  for (const file of files) {
    const bitmap = await createImageBitmap(file);
    const plan = planSize(bitmap.width, bitmap.height);
    const t0 = performance.now();
    const r = await encodeToTarget(jpegEncoder(bitmap), plan);
    const ms = Math.round(performance.now() - t0);
    const final = await prepareFile(file);
    out.push({
      name: file.name,
      inKB: Math.round(file.size / 1024),
      inDim: `${bitmap.width}x${bitmap.height}`,
      outDim: `${r.width}x${r.height}`,
      outKB: Math.round(final.size / 1024),
      q: r.quality,
      attempts: r.attempts,
      kept: final === file ? "original" : "jpeg",
      ms,
    });
    bitmap.close();
  }
  return out;
}, fixtures);
await browser.close();

console.log(
  "| file | in | in KB | out | out KB | quality | attempts | result | ms |\n| --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |",
);
for (const r of rows)
  console.log(
    `| ${r.name} | ${r.inDim} | ${r.inKB} | ${r.outDim} | ${r.outKB} | ${r.q} | ${r.attempts} | ${r.kept} | ${r.ms} |`,
  );
