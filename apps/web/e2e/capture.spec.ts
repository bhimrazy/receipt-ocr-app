import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, uploadFromReview } from "./helpers";

// Runs in the `mobile-camera` project (touch, 390x844 Chromium with a fake camera; the camera
// button is touch-only, see capture-desktop.spec.ts for desktop). Uploads need the
// fixture OCR provider, like upload.spec.ts.
test.skip(
  process.env.E2E_UPLOAD !== "1",
  "set E2E_UPLOAD=1 and OCR_PROVIDER=fixture to run the capture flow",
);

test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 255);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
});

const receipt = path.join(import.meta.dirname, "../../../packages/bench/fixtures/npr-lakh.png");

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
  await expect(review.getByRole("heading", { name: "Adjust corners" })).toBeVisible();
  await expect(review.getByText("Photo 1 of 2").filter({ visible: true })).toBeVisible();
  // Step 1: rotate, then move a corner with the keyboard.
  await review.getByRole("button", { name: "Rotate" }).click();
  const corner = review.getByRole("button", { name: /^Top-left corner/ });
  const before = await corner.getAttribute("aria-label");
  await corner.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(corner).not.toHaveAttribute("aria-label", before!);
  await expect(review.getByRole("button", { name: "Use full image" })).toBeEnabled();
  // Step 2: the flattened page, with filters and the planned size.
  await review.getByRole("button", { name: "Next" }).click();
  await expect(review.getByRole("heading", { name: "Preview" })).toBeVisible();
  await review.getByRole("button", { name: "Greyscale" }).click();
  await expect(review.getByRole("button", { name: "Greyscale" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(review.getByTestId("resolution")).toHaveText(/^\d+ × \d+ px · ~\d+ (KB|MB)$/, {
    timeout: 15_000,
  });
  await expect(review.getByText(/Greyscale and B&W make the file smaller/)).toBeVisible();
  // Escape goes back to the corners, not out of the sheet.
  await page.keyboard.press("Escape");
  await expect(review.getByRole("heading", { name: "Adjust corners" })).toBeVisible();
  await review.getByRole("button", { name: "Next" }).click();
  // Photos switch in place; the filter is per photo.
  await review.getByRole("button", { name: "Photo 2" }).click();
  await expect(review.getByText("Photo 2 of 2").filter({ visible: true })).toBeVisible();

  await review.getByRole("button", { name: "Upload 2 receipts" }).click();
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
  await expect(page.locator("[data-ready]")).toBeAttached();
  await page.locator('input[type="file"][multiple]').setInputFiles(receipt);
  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review.getByRole("heading", { name: "Adjust corners" })).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Bottom-right corner, 100% across, 100% down" }),
  ).toBeVisible();
  await uploadFromReview(page);
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
});

/** A synthetic phone-photo-sized receipt (no real data), drawn in the page as a JPEG. */
async function largePhoto(page: Page) {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 3024;
    c.height = 4032;
    const x = c.getContext("2d")!;
    x.fillStyle = "#f7f5ef";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#222";
    x.font = "90px monospace";
    for (let y = 200, i = 1; y < c.height - 200; y += 140, i++)
      x.fillText(`Item ${i}  ${i}.99`, 300, y);
    return c.toDataURL("image/jpeg", 0.9);
  });
  return {
    name: "large.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(data.split(",")[1]!, "base64"),
  };
}

test("a large photo offers upload sizes, shows the choice at full size and sends it", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("upload-size"));
  await page.addInitScript(() => {
    const sizes: unknown[] = [];
    (window as unknown as { sizes: unknown[] }).sizes = sizes;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData) sizes.push(body.get("size_choice"));
      return send.call(this, body);
    };
  });
  await page.goto("/app");
  await expect(page.locator("[data-ready]")).toBeAttached();
  await page.locator('input[type="file"][multiple]').setInputFiles(await largePhoto(page));
  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review.getByRole("button", { name: /^Top-left corner/ })).toBeVisible({
    timeout: 15_000,
  });
  const fullImage = review.getByRole("button", { name: "Use full image" });
  if (await fullImage.isEnabled()) await fullImage.click();
  await review.getByRole("button", { name: "Next" }).click();

  const change = review.getByRole("button", { name: /Change/ });
  await expect(change).toBeVisible({ timeout: 15_000 });
  await expect(change).toHaveAttribute("aria-expanded", "false");
  await expect(review.getByTestId("resolution")).toHaveText(/^\d+ × \d+ px · ~\d+ (KB|MB)$/);
  await change.click();
  const sizes = review.getByRole("group", { name: "Upload size" });
  await expect(sizes.getByRole("radio", { name: /^Recommended/ })).toBeChecked();
  await sizes.getByRole("radio", { name: /^Smaller/ }).check();
  await expect(review.getByTestId("resolution")).toHaveText(/^800 × 1067 px · ~\d+ KB$/);

  await review.getByRole("button", { name: "See it at full size" }).click();
  const full = review.getByTestId("full-size").locator("img");
  await expect(full).toBeVisible({ timeout: 15_000 });
  expect(
    await full.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
  ).toEqual([800, 1067]);
  await review.getByRole("button", { name: "Done" }).click();
  await expect(review.getByRole("img", { name: /^Receipt preview/ })).toBeVisible();

  await review.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { sizes: unknown[] }).sizes)).toEqual([
    "smaller",
  ]);
});

/** Two copies of the receipt fixture, opened in the review sheet on its corners step. */
async function pickTwo(page: Page) {
  await page.goto("/app");
  await expect(page.locator("[data-ready]")).toBeAttached();
  await page.locator('input[type="file"][multiple]').setInputFiles([receipt, receipt]);
  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review.getByRole("button", { name: /^Top-left corner/ })).toBeVisible({
    timeout: 15_000,
  });
  return review;
}

test("the preview shows the chosen filter on the cropped image, swapped without unmounting", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("preview-filter"));
  const review = await pickTwo(page);
  await review.getByRole("button", { name: "Next" }).click();
  const preview = review.getByRole("img", { name: /^Receipt preview/ });
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await review.getByRole("button", { name: "Original" }).click();
  await expect(preview).toHaveAttribute("data-filter", "original");
  const original = await preview.getAttribute("src");

  // A removed preview image would be a flash: count removals while the filter changes.
  await preview.evaluate((img) => {
    const w = window as unknown as { removed: number };
    w.removed = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.removedNodes) if (n.contains(img)) w.removed++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await review.getByRole("button", { name: "B&W" }).click();
  await expect(preview).toHaveAttribute("data-filter", "bw");
  await expect.poll(() => preview.getAttribute("src")).not.toBe(original);

  // Black and white: every pixel is grey and almost all are near black or near white.
  const stats = await preview.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let extreme = 0;
    let coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 12) coloured++;
      if (r < 50 || r > 205) extreme++;
    }
    const n = data.length / 4;
    return { extreme: extreme / n, coloured: coloured / n };
  });
  expect(stats.coloured).toBeLessThan(0.01);
  expect(stats.extreme).toBeGreaterThan(0.95);
  expect(await page.evaluate(() => (window as unknown as { removed: number }).removed)).toBe(0);
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`no action moves the stage or the controls (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signUp(page, uniqueEmail("layout"));
    const review = await pickTwo(page);
    const spots = {
      stage: review.getByTestId("stage"),
      primary: review.getByRole("button", { name: /^(Next|Upload)/ }),
      photos: review.getByRole("list", { name: "Photos to upload" }),
    };
    const rects = async (extra: Record<string, ReturnType<typeof review.locator>> = {}) => {
      const out: Record<string, string> = {};
      for (const [name, loc] of Object.entries({ ...spots, ...extra })) {
        const box = await loc.boundingBox();
        out[name] = box
          ? [box.x, box.y, box.width, box.height].map((n) => Math.round(n)).join(",")
          : "none";
      }
      return out;
    };
    // Rects may differ by 1px from rounding; compare each number within 1.
    const same = (a: Record<string, string>, b: Record<string, string>) => {
      for (const key of Object.keys(a)) {
        const x = a[key]!.split(",").map(Number);
        const y = b[key]!.split(",").map(Number);
        expect(x.length, key).toBe(y.length);
        x.forEach((n, i) =>
          expect(Math.abs(n - y[i]!), `${key} ${a[key]} vs ${b[key]}`).toBeLessThanOrEqual(1),
        );
      }
    };
    const settle = () => page.waitForTimeout(400);
    const controls = { controls: review.getByTestId("controls") };

    // Step 1.
    const base = await rects(controls);
    for (const name of ["Rotate", "Rotate", "Use full image", "Reset to detected"]) {
      const button = review.getByRole("button", { name });
      if (await button.isEnabled()) await button.click();
      await settle();
      same(base, await rects(controls));
    }
    const corner = review.getByRole("button", { name: /^Top-left corner/ });
    const box = (await corner.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 4 });
    await expect(review.getByTestId("loupe")).toBeVisible();
    same(base, await rects(controls));
    await page.mouse.up();
    await expect(review.getByTestId("loupe")).toHaveCount(0);
    await review.getByRole("button", { name: "Photo 2" }).click();
    await expect(review.getByText("Photo 2 of 2").filter({ visible: true })).toBeVisible();
    await settle();
    same(base, await rects(controls));

    // Step 2: every filter, then a photo switch and back to step 1.
    await review.getByRole("button", { name: "Next" }).click();
    await expect(review.getByRole("img", { name: /^Receipt preview/ })).toBeVisible({
      timeout: 15_000,
    });
    const filters = {
      controls: review.getByTestId("controls"),
      hint: review.getByTestId("resolution"),
    };
    const preview = await rects(filters);
    for (const name of ["Original", "Enhance", "Greyscale", "B&W", "Original"]) {
      await review.getByRole("button", { name, exact: true }).click();
      await settle();
      same(preview, await rects(filters));
    }
    await review.getByRole("button", { name: "Photo 1" }).click();
    await expect(review.getByText("Photo 1 of 2").filter({ visible: true })).toBeVisible();
    await settle();
    same(preview, await rects(filters));
    const stageBefore = (await spots.stage.boundingBox())!;
    await review.getByRole("button", { name: "Adjust corners", exact: true }).click();
    await settle();
    const stageAfter = (await spots.stage.boundingBox())!;
    expect(stageAfter).toEqual(stageBefore);
  });
}

test("every control is reachable on a short phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await signUp(page, uniqueEmail("short-phone"));
  const review = await pickTwo(page);
  await review.getByRole("button", { name: "Next" }).click();
  await expect(review.getByRole("img", { name: /^Receipt preview/ })).toBeVisible({
    timeout: 15_000,
  });
  // Clicking scrolls the panel to the button, which only works if the panel scrolls.
  await review.getByRole("button", { name: "Adjust corners", exact: true }).click();
  await expect(review.getByRole("heading", { name: "Adjust corners" })).toBeVisible();
  await expect(review.getByRole("button", { name: "Next" })).toBeInViewport({ ratio: 1 });
});

test("picking more than the batch limit keeps the first ones and says so", async ({ page }) => {
  await signUp(page, uniqueEmail("batch-limit"));
  await page.goto("/app");
  await expect(page.locator("[data-ready]")).toBeAttached();
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
  await uploadFromReview(page);
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
  await uploadFromReview(page);
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/upload$/);
  await expect(page.getByRole("heading", { name: "Upload receipts" })).toBeVisible();
  await expect(camera).toHaveCount(0);
});

/** Picks `count` copies of the receipt and sends them from review, as one queued batch. */
async function readBatch(page: Page, count: number) {
  // Files set before hydration land on an input with no change handler and are lost.
  await expect(page.locator("[data-ready]")).toBeAttached();
  await page
    .locator('input[type="file"][multiple]')
    .setInputFiles(Array.from({ length: count }, () => receipt));
  const review = page.getByRole("dialog", { name: "Review photos" });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Next" }).click();
  await review.getByRole("button", { name: `Upload ${count} receipts` }).click();
}

const accepted = (n: number) => ({
  status: 201,
  contentType: "application/json",
  body: JSON.stringify({ receiptId: `00000000-0000-4000-8000-00000000000${n}` }),
});

test("a failed upload shows Retry, and the retry goes through", async ({ page }) => {
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
  const list = page.getByRole("list", { name: "Receipts to scan" });
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
  const list = page.getByRole("list", { name: "Receipts to scan" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  // Two were in flight when the limit came back; the third was never sent.
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole("button", { name: "Scan 3 receipts" })).toBeEnabled();
});
