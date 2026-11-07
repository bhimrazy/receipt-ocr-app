// Renders the PWA PNG icons from apps/web/app/icon.svg with the repo's Playwright Chromium, so no
// image library is needed. Re-run after changing the SVG, and commit the PNGs:
//
//   bun scripts/pwa-icons.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const svg = readFileSync(path.join(root, "apps/web/app/icon.svg"), "utf8");
const web = path.join(root, "apps/web");

// The SVG is a rounded emerald tile with a 24-unit receipt glyph inside its 32-unit box. Full-bleed
// variants reuse the glyph on a square tile so the platform mask (circle, squircle) cuts only colour.
const tile = svg.match(/<rect[^>]*fill="([^"]+)"/)?.[1];
const glyph = svg.match(/<g[\s\S]*<\/g>/)?.[0];
if (!tile || !glyph) throw new Error("icon.svg no longer has the expected <rect> and <g>");

/** `glyphShare`: the glyph's 24-unit box as a share of the icon's width. */
function fullBleed(glyphShare: number) {
  const scale = (32 * glyphShare) / 24;
  const offset = (32 - 24 * scale) / 2;
  const inner = glyph!.replace(
    /transform="[^"]*"/,
    `transform="translate(${offset} ${offset}) scale(${scale})"`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${tile}"/>${inner}</svg>`;
}

// Paths under apps/web. app/apple-icon.png is Next's file convention, which keeps app/icon.svg as
// the favicon (an `icons` metadata field would replace it).
const icons: { file: string; size: number; svg: string }[] = [
  { file: "public/icons/icon-192.png", size: 192, svg },
  { file: "public/icons/icon-512.png", size: 512, svg },
  // Maskable: everything that matters sits inside the central 80% circle (the receipt's corners
  // reach 0.32 of the width from the centre at this scale; the safe radius is 0.4).
  { file: "public/icons/icon-maskable-512.png", size: 512, svg: fullBleed(0.6) },
  // iOS rounds the corners itself and shows transparency as black, so this one is opaque.
  { file: "app/apple-icon.png", size: 180, svg: fullBleed(0.75) },
];

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const sized = icon.svg.replace("<svg ", `<svg width="${icon.size}" height="${icon.size}" `);
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    await page.locator("svg").screenshot({ path: path.join(web, icon.file), omitBackground: true });
    await page.close();
    console.log(`wrote apps/web/${icon.file}`);
  }
} finally {
  await browser.close();
}
