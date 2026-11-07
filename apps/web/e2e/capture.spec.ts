import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// Runs in the `mobile-camera` project: 390x844 Chromium with a fake camera. Uploads need the
// fixture OCR provider, like upload.spec.ts.
test.skip(
  process.env.E2E_UPLOAD !== "1",
  "set E2E_UPLOAD=1 and OCR_PROVIDER=fixture to run the capture flow",
);

test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 255);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
});

const receipt = path.join(import.meta.dirname, "../../../bench/fixtures/npr-lakh.png");

/**
 * Records the type and first bytes of every uploaded file in the page: Playwright can't read
 * a multipart body that holds a Blob.
 */
async function recordUploads(page: Page) {
  await page.addInitScript(() => {
    const seen: { type: string; head: number[]; hasExif: boolean }[] = [];
    (window as unknown as { uploads: typeof seen }).uploads = seen;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      const file = body instanceof FormData ? body.get("file") : null;
      if (file instanceof Blob) {
        void file.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
          seen.push({
            type: file.type,
            head: [...bytes.subarray(0, 3)],
            hasExif: text.includes("Exif"),
          });
        });
      }
      return send.call(this, body);
    };
  });
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { uploads: { type: string; head: number[]; hasExif: boolean }[] })
          .uploads,
    );
}

test("take two photos, edit one, and upload both", async ({ page }) => {
  await signUp(page, uniqueEmail("capture"));
  const uploaded = await recordUploads(page);
  // The home-screen shortcut opens the camera straight away.
  await page.goto("/app/upload?capture=1");
  const camera = page.getByRole("dialog", { name: "Camera" });
  const shutter = camera.getByRole("button", { name: "Take photo" });
  await expect(shutter).toBeEnabled({ timeout: 15_000 });
  await shutter.click();
  await expect(camera.getByRole("list", { name: "Photos taken" }).getByRole("img")).toHaveCount(1);
  await shutter.click();
  await expect(camera.getByRole("list", { name: "Photos taken" }).getByRole("img")).toHaveCount(2);
  await camera.getByRole("button", { name: /Done/ }).click();
  await expect(camera).toHaveCount(0);

  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review.getByText("1 of 2")).toBeVisible();
  // Rotate, then move a corner with the keyboard.
  await review.getByRole("button", { name: "Rotate" }).click();
  const corner = review.getByRole("button", { name: /^Top-left corner/ });
  const before = await corner.getAttribute("aria-label");
  await corner.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(corner).not.toHaveAttribute("aria-label", before!);
  await expect(review.getByRole("button", { name: "Use full image" })).toBeEnabled();
  await review.getByRole("button", { name: "Greyscale" }).click();
  await expect(review.getByRole("button", { name: "Greyscale" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(review.getByText(/to upload\. Greyscale and B&W make the file smaller/)).toBeVisible(
    { timeout: 15_000 },
  );
  // Delete is per photo; go to the second and back.
  await review.getByRole("button", { name: "Photo 2" }).click();
  await expect(review.getByText("2 of 2")).toBeVisible();

  await review.getByRole("button", { name: "Read 2 receipts" }).click();
  await expect(page.getByText("2 receipts uploaded.")).toBeVisible({ timeout: 30_000 });
  const files = await uploaded();
  expect(files).toHaveLength(2);
  for (const file of files) {
    // Canvas output: a JPEG with no EXIF block.
    expect(file.type).toBe("image/jpeg");
    expect(file.head).toEqual([0xff, 0xd8, 0xff]);
    expect(file.hasExif).toBe(false);
  }
});

test("a picked photo is reviewed, then read and opened", async ({ page }) => {
  await signUp(page, uniqueEmail("pick-review"));
  await page.goto("/app");
  await page.locator('input[type="file"][multiple]').setInputFiles(receipt);
  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review.getByText("Check the photo")).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Bottom-right corner, 100% across, 100% down" }),
  ).toBeVisible();
  await review.getByRole("button", { name: "Read receipt" }).click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
});

test("picking more than the batch limit keeps the first ones and says so", async ({ page }) => {
  await signUp(page, uniqueEmail("batch-limit"));
  await page.goto("/app");
  const files = Array.from({ length: 51 }, () => receipt);
  await page.locator('input[type="file"][multiple]').setInputFiles(files);
  await expect(
    page.getByText(/Added the first (\d+); \d+ left out\. Up to \1 receipts at a time\./),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Review photos" })).toBeVisible();
});

test("without getUserMedia, Take photos opens the phone's camera app", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await signUp(page, uniqueEmail("fallback"));
  await page.goto("/app");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Take photos" }).click();
  await (await chooser).setFiles(receipt);
  const review = page.getByRole("dialog", { name: "Review photos" });
  await review.getByRole("button", { name: "Read receipt" }).click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
});

test("when camera access is blocked, it says so and offers the camera app", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("blocked", "NotAllowedError"));
  });
  await signUp(page, uniqueEmail("denied"));
  await page.goto("/app");
  await page.getByRole("button", { name: "Take photos" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(camera.getByRole("alert")).toContainText("Camera access was blocked");
  const chooser = page.waitForEvent("filechooser");
  await camera.getByRole("button", { name: "Use the camera app" }).click();
  await chooser;
  await expect(camera).toHaveCount(0);
});

test("closing the camera stops it", async ({ page }) => {
  await signUp(page, uniqueEmail("camera-stop"));
  await page.goto("/app");
  await page.getByRole("button", { name: "Take photos" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(camera.getByRole("button", { name: "Take photo" })).toBeEnabled({
    timeout: 15_000,
  });
  const live = () =>
    page.evaluate(() => {
      const video = document.querySelector("video");
      const stream = video?.srcObject as MediaStream | null | undefined;
      return stream?.getTracks().some((t) => t.readyState === "live") ?? false;
    });
  expect(await live()).toBe(true);
  // Keep a handle on the track so it can be checked after the sheet unmounts.
  await page.evaluate(() => {
    const stream = document.querySelector("video")!.srcObject as MediaStream;
    (window as unknown as { track: MediaStreamTrack }).track = stream.getVideoTracks()[0]!;
  });
  await camera.getByRole("button", { name: "Close camera" }).click();
  await expect(camera).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { track: MediaStreamTrack }).track.readyState),
  ).toBe("ended");
});

test("the camera link opens once: Back from the receipt doesn't reopen it", async ({ page }) => {
  await signUp(page, uniqueEmail("capture-back"));
  await page.goto("/app/upload?capture=1");
  const camera = page.getByRole("dialog", { name: "Camera" });
  const shutter = camera.getByRole("button", { name: "Take photo" });
  await expect(shutter).toBeEnabled({ timeout: 15_000 });
  // The parameter is spent, so the next Scan tap is a fresh navigation.
  await expect(page).toHaveURL(/\/app\/upload$/);
  await shutter.click();
  await camera.getByRole("button", { name: /Done/ }).click();
  await page
    .getByRole("dialog", { name: "Review photos" })
    .getByRole("button", { name: "Read receipt" })
    .click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/upload$/);
  await expect(page.getByRole("heading", { name: "Upload receipts" })).toBeVisible();
  await expect(camera).toHaveCount(0);
});

/** Picks `count` copies of the receipt and sends them from review, as one queued batch. */
async function readBatch(page: Page, count: number) {
  await page
    .locator('input[type="file"][multiple]')
    .setInputFiles(Array.from({ length: count }, () => receipt));
  // The review sheet is a lazy chunk; on a busy runner it can take a while to arrive.
  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.getByRole("button", { name: `Read ${count} receipts` }).click();
}

const accepted = (n: number) => ({
  status: 201,
  contentType: "application/json",
  body: JSON.stringify({ receiptId: `00000000-0000-4000-8000-00000000000${n}` }),
});

test("a failed upload shows Retry, and the retry goes through", async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, uniqueEmail("batch-retry"));
  let calls = 0;
  await page.route("**/api/receipts", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    return calls === 1
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Something went wrong on our side." }),
        })
      : route.fulfill(accepted(calls));
  });
  await page.goto("/app");
  await readBatch(page, 2);
  const list = page.getByRole("list", { name: "Receipts to read" });
  await expect(list.getByText("Something went wrong on our side.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("1 receipt uploaded.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await list.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("1 receipt uploaded.")).toBeVisible();
  await expect(list).toHaveCount(0);
  await expect.poll(() => calls).toBe(3);
});

test("a per-minute 429 pauses the batch, then it carries on by itself", async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, uniqueEmail("batch-pause"));
  let calls = 0;
  await page.route("**/api/receipts", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    return calls === 1
      ? route.fulfill({
          status: 429,
          headers: { "Retry-After": "3" },
          contentType: "application/json",
          body: JSON.stringify({ error: "Too many uploads this minute." }),
        })
      : route.fulfill(accepted(calls));
  });
  await page.goto("/app");
  await readBatch(page, 3);
  await expect(page.getByText(/Paused for your plan's per-minute limit/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("3 receipts uploaded.")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => calls).toBe(4);
});

test("a daily 429 stops the batch and keeps the rest", async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, uniqueEmail("batch-stop"));
  let calls = 0;
  await page.route("**/api/receipts", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "36000" },
      contentType: "application/json",
      body: JSON.stringify({ error: "You've reached today's limit." }),
    });
  });
  await page.goto("/app");
  await readBatch(page, 3);
  await expect(
    page.getByRole("alert").filter({ hasText: "The rest are still here" }),
  ).toContainText("You've reached today's limit.", { timeout: 30_000 });
  const list = page.getByRole("list", { name: "Receipts to read" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  // Two were in flight when the limit came back; the third was never sent.
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole("button", { name: "Read 3 receipts" })).toBeEnabled();
});
