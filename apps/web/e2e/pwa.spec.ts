import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signOut, signUp, uniqueEmail } from "./helpers";

// Runs against `next build && next start`: the service worker registers only in production builds.

const RECEIPT = readFileSync(
  path.join(import.meta.dirname, "../../../bench/fixtures/npr-lakh.png"),
);

// Sign-up is limited per client IP; give every test its own address.
test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 255);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
});

/** Waits until the worker controls the page, reloading once if it activated after load. */
async function controlledBySw(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))))
    await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

/** What the Android share sheet sends: a multipart POST navigation to the manifest's action. */
async function shareFile(page: Page, name: string) {
  await page.evaluate(
    ({ bytes, name }) => {
      const form = Object.assign(document.createElement("form"), {
        method: "post",
        action: "/share-target",
        enctype: "multipart/form-data",
      });
      const input = Object.assign(document.createElement("input"), {
        type: "file",
        name: "receipts",
      });
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }));
      input.files = transfer.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { bytes: [...RECEIPT], name },
  );
}

const queued = (page: Page) => page.getByRole("list", { name: "Receipts to read" });

test("the manifest is installable and every icon resolves at its declared size", async ({
  page,
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    theme_color: "#0a0a0b",
    background_color: "#0a0a0b",
    shortcuts: [{ name: "Scan receipt", url: "/app/upload?capture=1" }],
    share_target: { action: "/share-target", method: "POST", enctype: "multipart/form-data" },
  });
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(
    true,
  );

  const icons = [...manifest.icons, { src: "/apple-icon.png", sizes: "180x180" }];
  for (const icon of icons) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    if (icon.sizes === "any") continue;
    // PNG IHDR: width and height are big-endian at bytes 16 and 20.
    const body = await response.body();
    expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
  }

  // Chromium's own installability check (what drives the install prompt).
  await page.goto("/");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /^\/apple-icon\.png/,
  );
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
  // The worker registers only from the signed-in app.
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
});

test("the worker script is served uncached and allowed by the CSP", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.headers()["cache-control"]).toContain("no-cache");
  expect(response.headers()["content-type"]).toContain("javascript");
  expect(response.headers()["content-security-policy-report-only"]).toContain("worker-src 'self'");
});

test("without a service worker, a share lands on the upload page", async ({ request }) => {
  const response = await request.post("/share-target", {
    multipart: { receipts: { name: "r.png", mimeType: "image/png", buffer: RECEIPT } },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe("/app/upload?shared=unavailable");
});

test("the worker registers in the app, never stores API or page responses, and serves the offline page", async ({
  page,
  context,
}) => {
  await signUp(page, uniqueEmail("pwa"));
  await controlledBySw(page);

  const api = page.waitForResponse((r) => r.url().includes("/api/receipts/status"));
  await page.evaluate(() => fetch("/api/receipts/status"));
  expect((await api).fromServiceWorker()).toBe(false);

  await page.goto("/app/history");
  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys())
        urls.push(new URL(request.url).pathname);
    }
    return urls.sort();
  });
  expect(stored).toEqual(["/icon.svg", "/icons/icon-192.png", "/offline.html"]);

  await context.setOffline(true);
  await page.goto("/app/history").catch(() => null);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // Back online, the fallback reloads itself into the page that was asked for.
  await context.setOffline(false);
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
});

test("a receipt shared to the app is queued on the upload page", async ({ page }) => {
  await signUp(page, uniqueEmail("share"));
  await controlledBySw(page);

  await shareFile(page, "shared-receipt.png");
  await expect(page).toHaveURL(/\/app(\/upload)?(\?|$)/);
  await expect(queued(page)).toContainText("shared-receipt.");

  // Taken once: a reload doesn't queue it again.
  await page.reload();
  await expect(page.getByRole("button", { name: "Add receipt photos or PDFs" })).toBeVisible();
  await expect(queued(page)).toHaveCount(0);
});

test("a share made while signed out waits for sign-in", async ({ page }) => {
  const email = uniqueEmail("share-out");
  await signUp(page, email);
  await controlledBySw(page);
  await signOut(page);

  await shareFile(page, "after-sign-in.png");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(queued(page)).toContainText("after-sign-in.");
});
