// Renders the iOS PWA startup images in apps/web/public/splash with the repo's Playwright
// Chromium and the real DM Sans and JetBrains Mono files, so no system font can substitute.
// Re-run after changing the brand master or the layout, and commit the PNGs:
//
//   bun run splash:ios
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { renderMaster } from "./brand-assets";
import {
  type SplashTheme,
  splashDevices,
  splashFile,
  splashPixels,
  splashThemes,
} from "../apps/web/lib/ios-splash";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "apps/web/public/splash");
const fontDir = path.join(import.meta.dirname, "splash-fonts");

const palette: Record<SplashTheme, { bg: string; text: string; muted: string; tile: string }> = {
  dark: { bg: "#0a0a0b", text: "#e4e4e7", muted: "#9a9aa3", tile: "#34d399" },
};

/** The brand master as a data URI, rendered at device pixels so the strokes stay sharp. */
async function icon(px: number, dpr: number) {
  const png = await renderMaster("app-icon", Math.round(px * dpr));
  return `<img src="data:image/png;base64,${png.toString("base64")}" width="${px}" height="${px}">`;
}

const font = (file: string) =>
  `data:font/woff2;base64,${readFileSync(path.join(fontDir, file)).toString("base64")}`;

// Sizes are points for a 390pt-wide iPhone, multiplied by `s` on larger screens.
function html(theme: SplashTheme, w: number, h: number, s: number, iconHtml: string) {
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
<div class="group">${iconHtml}<span class="wm">Receipt<b>OCR</b></span></div>
<div class="by"><span class="k">A product by</span><span class="n">Bhimraj Yadav</span></div>
</body></html>`;
}

rmSync(outDir, { recursive: true, force: true });
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
      await page.setContent(html(theme, w, h, s, await icon(64 * s, d.dpr)));
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
