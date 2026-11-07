// Renders the iOS PWA startup images in apps/web/public/splash with the repo's Playwright
// Chromium and the real DM Sans and JetBrains Mono files, so no system font can substitute.
// Re-run after changing the icon or the layout, and commit the PNGs:
//
//   bun run splash:ios
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  type SplashTheme,
  splashDevices,
  splashFile,
  splashPixels,
  splashThemes,
} from "../apps/web/lib/ios-splash";

// Switching to the new brand mark is a change to this one line.
const ICON_SOURCE = "apps/web/app/icon.svg";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "apps/web/public/splash");
const fontDir = path.join(import.meta.dirname, "splash-fonts");

const palette: Record<
  SplashTheme,
  { bg: string; text: string; muted: string; tile: string; glyph: string }
> = {
  dark: { bg: "#0a0a0b", text: "#e4e4e7", muted: "#9a9aa3", tile: "#34d399", glyph: "#07110d" },
  light: { bg: "#f6f8f7", text: "#0d1512", muted: "#56635d", tile: "#047857", glyph: "#ffffff" },
};

const iconSvg = readFileSync(path.join(root, ICON_SOURCE), "utf8");
const srcTile = iconSvg.match(/<rect[^>]*fill="([^"]+)"/)?.[1];
const srcGlyph = iconSvg.match(/<g[^>]*stroke="([^"]+)"/)?.[1];
if (!srcTile || !srcGlyph)
  throw new Error(`${ICON_SOURCE} no longer has a tile <rect> and a stroked <g>`);

/** The icon recoloured for the theme; the source colours are the dark theme's. */
function icon(theme: SplashTheme, px: number) {
  const p = palette[theme];
  return iconSvg
    .replaceAll(srcTile!, p.tile)
    .replaceAll(srcGlyph!, p.glyph)
    .replace("<svg ", `<svg width="${px}" height="${px}" `);
}

const font = (file: string) =>
  `data:font/woff2;base64,${readFileSync(path.join(fontDir, file)).toString("base64")}`;

// Sizes are points for a 390pt-wide iPhone, multiplied by `s` on larger screens.
function html(theme: SplashTheme, w: number, h: number, s: number) {
  const p = palette[theme];
  return `<!doctype html><html><head><style>
@font-face{font-family:"DM Sans";font-weight:400 600;src:url(${font("DMSans-latin.woff2")}) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:500;src:url(${font("JetBrainsMono-500-latin.woff2")}) format("woff2")}
html,body{margin:0;width:${w}px;height:${h}px;background:${p.bg};overflow:hidden}
.group{position:absolute;left:0;right:0;top:${h * 0.44}px;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:${16 * s}px}
.wm{font:500 ${20 * s}px/1 "JetBrains Mono";letter-spacing:-0.02em;color:${p.text}}
.wm b{font-weight:500;color:${p.tile}}
.by{position:absolute;left:0;right:0;bottom:${58 * s}px;display:flex;flex-direction:column;align-items:center;gap:${7 * s}px;font-family:"DM Sans"}
.k{font-size:${13 * s}px;font-weight:400;line-height:1;color:${p.muted}}
.n{font-size:${12 * s}px;font-weight:600;line-height:1;letter-spacing:0.16em;text-transform:uppercase;color:${p.text};opacity:.78}
</style></head><body>
<div class="group">${icon(theme, 64 * s)}<span class="wm">Receipt<b>OCR</b></span></div>
<div class="by"><span class="k">A product by</span><span class="n">Bhimraj Yadav</span></div>
</body></html>`;
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of splashThemes) {
    for (const d of splashDevices) {
      const { width, height } = splashPixels(d);
      const [w, h] = [width / d.dpr, height / d.dpr];
      const s = Math.min(1.5, Math.max(1, Math.min(w, h) / 390));
      const page = await browser.newPage({
        viewport: { width: w, height: h },
        deviceScaleFactor: d.dpr,
      });
      await page.setContent(html(theme, w, h, s));
      await page.evaluate(() => document.fonts.ready);
      const file = splashFile(theme, d);
      await page.screenshot({ path: path.join(outDir, file) });
      await page.close();
      console.log(`wrote apps/web/public/splash/${file}`);
    }
  }
} finally {
  await browser.close();
}
