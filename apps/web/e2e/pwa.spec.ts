import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signOut, signUp, uniqueEmail } from "./helpers";

// Runs against `next build && next start`: the service worker registers only in production builds.

const RECEIPT = readFileSync(
  path.join(import.meta.dirname, "../../../packages/bench/fixtures/npr-lakh.png"),
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
async function shareFile(page: Page, name: string, type = "image/png") {
  await page.evaluate(
    ({ bytes, name, type }) => {
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
      transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
      input.files = transfer.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { bytes: [...RECEIPT], name, type },
  );
}

// Kept photos open the review sheet (#47) instead of joining the list; nothing uploads until Scan.
const review = (page: Page) => page.getByRole("dialog", { name: "Review photos" });
const sharedNotice = (page: Page) => page.getByRole("status", { name: "Shared files" });

/** Counts receipt uploads, to prove a share never uploads on its own. */
function countUploads(page: Page) {
  const uploads = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/receipts")
      uploads.count += 1;
  });
  return uploads;
}

test("the manifest is installable and every icon resolves at its declared size", async ({
  page,
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    id: "/app",
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    theme_color: "#0a0a0b",
    background_color: "#0a0a0b",
    shortcuts: [
      { name: "Add receipt", url: "/app/upload?capture=1" },
      { name: "History", url: "/app/history" },
    ],
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
    share_target: { action: "/share-target", method: "POST", enctype: "multipart/form-data" },
  });
  // Chrome's richer install dialog needs a narrow screenshot; desktop shows a wide one.
  const factors = manifest.screenshots.map((s: { form_factor: string }) => s.form_factor);
  expect(factors).toContain("narrow");
  expect(factors).toContain("wide");
  for (const shot of manifest.screenshots as { src: string; sizes: string; label: string }[]) {
    expect(shot.label).toBeTruthy();
    const response = await request.get(shot.src);
    expect(response.status(), shot.src).toBe(200);
    const body = await response.body();
    expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`, shot.src).toBe(shot.sizes);
  }
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

test("without a service worker, a share lands on the app with a notice", async ({ request }) => {
  const response = await request.post("/share-target", {
    multipart: { receipts: { name: "r.png", mimeType: "image/png", buffer: RECEIPT } },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe("/app?shared=unavailable");
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
  expect(stored).toEqual(["/icon.svg", "/icons/icon-192.png", "/offline.html", "/offline.js"]);

  await context.setOffline(true);
  await page.goto("/app/history").catch(() => null);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // Back online, the fallback reloads itself into the page that was asked for.
  await context.setOffline(false);
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
});

test("a shared receipt waits for Keep, then for Upload in the review sheet, and is never uploaded on its own", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("share"));
  await controlledBySw(page);
  const uploads = countUploads(page);

  // No type, as some Android apps send: the extension decides, as for a picked file.
  await shareFile(page, "shared-receipt.png", "");
  await expect(page).toHaveURL(/\/app(\/upload)?(\?|$)/);
  await expect(sharedNotice(page)).toContainText("1 file shared from another app");
  await expect(sharedNotice(page)).toContainText("shared-receipt.png");
  await expect(sharedNotice(page)).toContainText("Keep them only if you shared them");
  await expect(review(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Keep" }).click();
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByRole("button", { name: "Next" })).toBeVisible();
  await expect(sharedNotice(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(uploads.count).toBe(0);

  // Taken once: a reload shows neither the notice nor the file.
  await page.reload();
  await expect(page.getByRole("button", { name: "Add receipt photos or PDFs" })).toBeVisible();
  await expect(sharedNotice(page)).toHaveCount(0);
  await expect(review(page)).toHaveCount(0);
});

test("Discard drops a shared receipt without queueing it", async ({ page }) => {
  await signUp(page, uniqueEmail("discard"));
  await controlledBySw(page);
  await shareFile(page, "unwanted.png");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(sharedNotice(page)).toHaveCount(0);
  await expect(review(page)).toHaveCount(0);
});

test("a share posted by another site is dropped by the worker", async ({ page }) => {
  await signUp(page, uniqueEmail("xsite"));
  await controlledBySw(page);
  const appOrigin = new URL(page.url()).origin;
  const uploads = countUploads(page);

  await page.route("http://attacker.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<form method="post" action="${appOrigin}/share-target" enctype="multipart/form-data">
        <input type="file" name="receipts"></form>
        <script>
          const t = new DataTransfer();
          t.items.add(new File(["x"], "planted.png", { type: "image/png" }));
          const f = document.forms[0];
          f.receipts.files = t.files;
          f.submit();
        </script>`,
    }),
  );
  await page.goto("http://attacker.test/");
  await expect(page).toHaveURL(new RegExp(`^${appOrigin}/app`));
  await expect(page.getByRole("button", { name: "Add receipt photos or PDFs" })).toBeVisible();
  await expect(sharedNotice(page)).toHaveCount(0);
  expect(await page.evaluate(() => caches.has("receiptocr-shared"))).toBe(false);
  expect(uploads.count).toBe(0);
});

test("a share made while signed out waits for sign-in, and sign-out clears a waiting share", async ({
  page,
}) => {
  const email = uniqueEmail("share-out");
  await signUp(page, email);
  await controlledBySw(page);
  await signOut(page);

  await shareFile(page, "after-sign-in.png");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(sharedNotice(page)).toContainText("after-sign-in.png");
  await page.getByRole("button", { name: "Keep" }).click();
  await expect(review(page)).toBeVisible();
  await review(page).getByRole("button", { name: "Back without uploading" }).click();
  await page
    .getByRole("alertdialog", { name: "Discard this photo?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(review(page)).toHaveCount(0);

  // A share nobody picked up must not survive into the next account.
  await page.evaluate(async () => {
    const cache = await caches.open("receiptocr-shared");
    await cache.put(
      "/share-target/file/0",
      new Response("x", { headers: { "x-shared-at": String(Date.now()) } }),
    );
  });
  await signOut(page);
  expect(await page.evaluate(() => caches.has("receiptocr-shared"))).toBe(false);
});

test("the upload page explains a share that didn't come through", async ({ page }) => {
  await signUp(page, uniqueEmail("share-failed"));
  await page.goto("/app?shared=unavailable");
  await expect(
    page.getByText("Sharing to ReceiptOCR isn't ready on this device yet"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app?shared=failed");
  await expect(page.getByText("The shared files didn't come through")).toBeVisible();
});
