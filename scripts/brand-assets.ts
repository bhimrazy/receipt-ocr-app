// Renders every raster brand asset from the SVG masters in apps/web/brand with sharp. Re-run after
// editing a master and commit the outputs (table in apps/web/brand/README.md):
//
//   bun run brand:assets                       # write the assets
//   bun run brand:assets --sheet <file.png>    # also write a contact sheet to review them
//
// Other scripts (e.g. splash images) can import `renderMaster` to render from the same masters.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const web = path.join(root, "apps/web");
export const BRAND_DIR = path.join(web, "brand");

/** Renders `apps/web/brand/<name>.svg` as a square `size` px PNG (transparent where the SVG is). */
export async function renderMaster(name: string, size: number): Promise<Buffer> {
  const svg = readFileSync(path.join(BRAND_DIR, `${name}.svg`), "utf8").replace(
    "<svg ",
    `<svg width="${size}" height="${size}" `,
  );
  // density 72 makes one SVG unit one pixel; 4x the size, then downscale, anti-aliases the strokes.
  return sharp(Buffer.from(svg), { density: 72 * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An .ico holding PNG images (supported since Windows Vista and by every browser). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size, at);
    head.writeUInt8(size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

// [output under apps/web, master, size]. The app/ files use Next's file conventions, which is why
// metadata sets no `icons` field (it would replace them).
const pngs: [string, string, number][] = [
  ["public/icons/favicon-32.png", "app-icon-small", 32],
  ["public/icons/favicon-48.png", "app-icon-small", 48],
  ["app/apple-icon.png", "app-icon-maskable", 180], // iOS rounds the corners; transparency shows black
  ["public/icons/icon-192.png", "app-icon", 192],
  ["public/icons/icon-512.png", "app-icon", 512],
  ["public/icons/icon-maskable-512.png", "app-icon-maskable", 512],
  ["public/icons/icon-monochrome-512.png", "app-icon-monochrome", 512],
  ["public/brand/google-oauth-120.png", "app-icon", 120],
  ["public/brand/google-512.png", "app-icon", 512],
  ["public/brand/play-store-512.png", "app-icon-maskable", 512],
  ["public/brand/avatar-400.png", "app-icon-maskable", 400],
  ["public/brand/email-logo.png", "app-icon", 128],
];

async function main() {
  const out = (file: string) => {
    const full = path.join(web, file);
    mkdirSync(path.dirname(full), { recursive: true });
    return full;
  };
  for (const [file, master, size] of pngs) {
    writeFileSync(out(file), await renderMaster(master, size));
    console.log(`wrote apps/web/${file}`);
  }
  writeFileSync(
    out("app/favicon.ico"),
    ico(
      await Promise.all(
        [16, 32, 48].map(async (size) => ({
          size,
          png: await renderMaster("app-icon-small", size),
        })),
      ),
    ),
  );
  copyFileSync(path.join(BRAND_DIR, "app-icon-small.svg"), out("app/icon.svg"));
  console.log("wrote apps/web/app/favicon.ico, apps/web/app/icon.svg");

  const sheet = process.argv[process.argv.indexOf("--sheet") + 1];
  if (process.argv.includes("--sheet") && sheet) await contactSheet(sheet);
}

async function contactSheet(file: string) {
  const W = 1100;
  const H = 1000;
  const layers: sharp.OverlayOptions[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
  let shapes = rect(0, 0, W, H, "#16181d");
  const label = (x: number, y: number, t: string) =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#9aa0a6">${t}</text>`;
  let text = "";
  const put = (input: Buffer, left: number, top: number) => layers.push({ input, left, top });
  const x1 = async (name: string, size: number, scale = 1) =>
    sharp(await renderMaster(name, size))
      .resize(size * scale, size * scale, { kernel: "nearest" })
      .png()
      .toBuffer();

  // Favicons at 16/32/48 on light and dark tab strips, then 4x enlarged for inspection.
  text += label(20, 24, "Favicon 16 / 32 / 48 on light and dark tabs, then 4x");
  for (const [i, bg] of ["#f1f3f4", "#35363a"].entries()) {
    shapes += rect(20 + i * 250, 36, 240, 72, bg, 8);
    let x = 40 + i * 250;
    for (const s of [16, 32, 48]) {
      put(await x1("app-icon-small", s), x, 36 + (72 - s) / 2);
      x += s + 40;
    }
  }
  shapes += rect(520, 36, 560, 150, "#f1f3f4", 8);
  put(await x1("app-icon-small", 16, 8), 540, 50);
  put(await x1("app-icon-small", 32, 4), 700, 50);
  put(await x1("app-icon-small", 48, 3), 870, 50);

  // iOS home screen: the 180px icon under iOS's rounded-corner mask (about 22.4%).
  text += label(20, 230, "iOS home screen (apple-icon 180, iOS corner mask)");
  shapes += rect(20, 242, 330, 210, "#2a3a4f", 16);
  const mask = (s: number, r: number) =>
    Buffer.from(
      `<svg width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${r}"/></svg>`,
    );
  const ios = await sharp(await renderMaster("app-icon-maskable", 180))
    .composite([{ input: mask(180, 40), blend: "dest-in" }])
    .toBuffer();
  put(await sharp(ios).resize(90, 90).toBuffer(), 50, 280);
  put(ios, 160, 262);

  // Android masks over the 512 maskable, with the 80% safe circle drawn on the third.
  text += label(380, 230, "Android: circle, squircle, safe-zone (red = 80% circle)");
  const maskable = await renderMaster("app-icon-maskable", 192);
  const circle = await sharp(maskable)
    .composite([{ input: mask(192, 96), blend: "dest-in" }])
    .toBuffer();
  const squircle = await sharp(maskable)
    .composite([{ input: mask(192, 56), blend: "dest-in" }])
    .toBuffer();
  const zone = await sharp(maskable)
    .composite([
      {
        input: Buffer.from(
          `<svg width="192" height="192"><circle cx="96" cy="96" r="76.8" fill="none" stroke="#ff3b30" stroke-width="2"/></svg>`,
        ),
      },
    ])
    .toBuffer();
  [circle, squircle, zone].forEach((b, i) => put(b, 380 + i * 210, 242));

  // Google surfaces and lockups.
  text += label(
    20,
    490,
    "Google OAuth consent 120 (light, dark) / email logo 128 shown at 64 / tile / mono",
  );
  shapes += rect(20, 502, 150, 150, "#ffffff", 8) + rect(180, 502, 150, 150, "#202124", 8);
  put(await renderMaster("app-icon", 120), 35, 517);
  put(await renderMaster("app-icon", 120), 195, 517);
  shapes += rect(340, 502, 150, 150, "#ffffff", 8);
  put(
    await sharp(await renderMaster("app-icon", 128))
      .resize(64, 64)
      .toBuffer(),
    383,
    545,
  );
  put(await renderMaster("app-icon-light", 120), 500, 517);
  shapes += rect(640, 502, 150, 150, "#16181d", 8) + rect(800, 502, 150, 150, "#ffffff", 8);
  put(
    await sharp(await renderMaster("app-icon-monochrome", 120))
      .negate({ alpha: false })
      .toBuffer(),
    655,
    517,
  );
  put(await renderMaster("app-icon-monochrome", 120), 815, 517);

  // Lockups (text uses the system monospace here, Geist Mono on the web).
  text += label(20, 690, "Lockups: dark, light, one-colour");
  shapes += rect(20, 702, 340, 90, "#0a0a0b", 8) + rect(380, 702, 340, 90, "#f6f8f7", 8);
  shapes += rect(740, 702, 340, 90, "#ffffff", 8);
  for (const [i, name] of ["lockup-dark", "lockup-light", "lockup-mono"].entries()) {
    const svg = readFileSync(path.join(BRAND_DIR, `${name}.svg`), "utf8").replace(
      "<svg ",
      `<svg width="300" height="57" color="#0d1512" `,
    );
    put(await sharp(Buffer.from(svg), { density: 72 }).png().toBuffer(), 40 + i * 360, 718);
  }

  const base = sharp(Buffer.from(`<svg width="${W}" height="${H}">${shapes}${text}</svg>`));
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  await base.composite(layers).png().toFile(path.resolve(file));
  console.log(`wrote ${file}`);
}

if (import.meta.main) await main();
