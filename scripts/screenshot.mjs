#!/usr/bin/env node
// Full-page screenshots of a running instance at desktop and phone widths, using the project's
// Playwright (`bunx playwright install chromium` once per machine).
//
//   node scripts/screenshot.mjs --out <dir> [--base http://localhost:3000]
//        [--login email:password] [--widths 1440,390] [--theme light|dark]
//        [--wait networkidle|load] <path>...
//
// --wait load is for `next dev`: its hot-reload socket keeps the network busy, and first compiles
// are slow, so it also allows 120 s a page (default: networkidle, 30 s).
// --theme stores that choice before each page loads, as the theme toggle does (default: dark).
// --login signs in through the Better Auth API first, so app routes render as that user.
// Files are named <path-slug>@<width>-<theme>.png. Console errors and failed requests are printed per page.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const valued = new Set(["--out", "--base", "--login", "--widths", "--theme", "--wait"]);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const paths = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const out = flag("out");
if (!out || paths.length === 0) {
  console.error(
    "usage: screenshot.mjs --out <dir> [--base URL] [--login email:password] [--widths 1440,390] [--theme light|dark] [--wait networkidle|load] <path>...",
  );
  process.exit(2);
}
const base = flag("base", "http://localhost:3000");
const widths = flag("widths", "1440,390").split(",").map(Number);
const theme = flag("theme", "dark");
if (theme !== "light" && theme !== "dark") {
  console.error(`--theme must be light or dark, not ${theme}`);
  process.exit(2);
}
const waitUntil = flag("wait", "networkidle");
if (waitUntil !== "networkidle" && waitUntil !== "load") {
  console.error(`--wait must be networkidle or load, not ${waitUntil}`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      deviceScaleFactor: width < 600 ? 2 : 1,
      colorScheme: theme,
    });
    await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
    const login = flag("login");
    if (login) {
      const [email, ...rest] = login.split(":");
      const res = await context.request.post(new URL("/api/auth/sign-in/email", base).href, {
        data: { email, password: rest.join(":") },
        headers: { origin: base },
      });
      if (!res.ok()) throw new Error(`sign-in failed: HTTP ${res.status()}`);
    }
    const page = await context.newPage();
    for (const p of paths) {
      const problems = [];
      const onConsole = (m) =>
        m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`);
      const onFail = (r) =>
        problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`);
      page.on("console", onConsole);
      page.on("requestfailed", onFail);
      const res = await page.goto(
        new URL(p, base).href,
        waitUntil === "load" ? { waitUntil, timeout: 120_000 } : { waitUntil },
      );
      await page.waitForTimeout(400); // let entrance animations settle
      const slug = p.replace(/^\/|\/$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home";
      const file = path.join(out, `${slug}@${width}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${file} HTTP ${res?.status()} → ${new URL(page.url()).pathname}`);
      for (const line of problems) console.log(`  ${line}`);
      page.off("console", onConsole);
      page.off("requestfailed", onFail);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
