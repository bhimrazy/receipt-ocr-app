import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { emulateStandalone, seedReceipts, signUp, uniqueEmail } from "./helpers";

// Phone shell: keyboard-safe sheets, the offline bar and refresh on return.
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
test.use(phone);

// One account for the file: sign-up is rate-limited per client.
test.describe.configure({ mode: "serial" });
const email = uniqueEmail("shell");
let session: BrowserContextOptions["storageState"];

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    ...phone,
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
  });
  const page = await context.newPage();
  await signUp(page, email);
  await seedReceipts(email, ["Corner Shop"]);
  await page.goto("/app/receipts/groups");
  await page.getByLabel("Name").fill("Trip");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("button", { name: "Edit Trip" })).toBeVisible();
  session = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(session) });

async function box(page: Page, name: string) {
  const rect = await page.getByRole("dialog", { name }).boundingBox();
  if (!rect) throw new Error(`no ${name} dialog`);
  return { ...rect, bottom: Math.round(rect.y + rect.height) };
}

/** Shrinks the visual viewport the way the iOS keyboard does; the layout viewport stays. */
async function openKeyboard(page: Page, visibleHeight: number) {
  await page.evaluate((height) => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => height });
    viewport.dispatchEvent(new Event("resize"));
  }, visibleHeight);
}

test("a dialog with a text field opens as a bottom sheet and rises above the keyboard", async ({
  page,
}) => {
  await page.goto("/app/receipts/groups");
  await page.getByRole("button", { name: "Edit Trip" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit group" });
  await expect(sheet).toBeVisible();
  // Settles at the bottom edge, full width (after the slide-in).
  await expect.poll(async () => (await box(page, "Edit group")).bottom).toBe(844);
  const docked = await box(page, "Edit group");
  expect(docked.x).toBe(0);
  expect(docked.width).toBe(390);

  await sheet.getByLabel("Name").focus();
  await openKeyboard(page, 500);
  await expect.poll(async () => (await box(page, "Edit group")).bottom).toBe(500);
  for (const target of [sheet.getByLabel("Name"), sheet.getByRole("button", { name: "Save" })]) {
    const rect = (await target.boundingBox())!;
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(500);
  }

  await openKeyboard(page, 844);
  await expect.poll(async () => (await box(page, "Edit group")).bottom).toBe(844);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("on a desktop the same dialog stays centred", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/receipts/groups");
  await page.getByRole("button", { name: "Edit Trip" }).click();
  await expect(page.getByRole("dialog", { name: "Edit group" })).toBeVisible();
  await expect
    .poll(async () => {
      const rect = await box(page, "Edit group");
      return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)];
    })
    .toEqual([640, 400]);
});

test("offline, the screen stays, a bar says so, and links wait for the connection", async ({
  page,
  context,
}) => {
  await page.goto("/app");
  const bar = page.locator("[data-slot=offline-bar]");
  await expect(page.locator("[data-ready]").first()).toBeVisible();
  await expect(bar).toBeEmpty();

  await context.setOffline(true);
  await expect(bar).toHaveText(
    "You're offline. Opening pages and saving changes need a connection.",
  );
  // Under the app bar, not over it.
  const appBar = (await page.locator("[data-slot=app-bar]").boundingBox())!;
  expect(Math.round((await bar.boundingBox())!.y)).toBe(Math.round(appBar.y + appBar.height));

  // A photo can still be added; the upload waits and says why.
  await page
    .locator('[data-ready] input[type="file"][multiple]')
    .first()
    .setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
    });
  await expect(page.getByRole("button", { name: "Scan receipt" })).toBeDisabled();
  await expect(page.getByText("You're offline. These stay here")).toBeVisible();

  // A tab tap keeps this screen instead of loading offline.html.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Receipts" })
    .click();
  await expect(bar).toContainText("that page can't open");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "You're offline" })).toHaveCount(0);

  await context.setOffline(false);
  await expect(bar).toBeEmpty();
  await expect(page.getByRole("button", { name: "Scan receipt" })).toBeEnabled();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Receipts" })
    .click();
  await expect(page).toHaveURL(/\/app\/receipts$/);
});

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (value ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.describe("installed app", () => {
  test.beforeEach(({ page }) => emulateStandalone(page));

  test("coming back after a minute refreshes the screen in place; a quick switch doesn't", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto("/app/receipts");
    const search = page.getByRole("searchbox", { name: "Search receipts" });
    await search.fill("Corner");
    await expect(page).toHaveURL(/q=Corner/);
    await expect(page.getByText("Corner Shop").first()).toBeVisible();
    // Gone if the page reloads rather than refreshes.
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));

    const refreshes: string[] = [];
    page.on("request", (request) => {
      const headers = request.headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"]) refreshes.push(request.url());
    });

    await setHidden(page, true);
    await page.clock.fastForward(5_000);
    await setHidden(page, false);
    await page.waitForTimeout(500);
    expect(refreshes).toEqual([]);

    await setHidden(page, true);
    await page.clock.fastForward("01:01");
    const refreshed = page.waitForResponse(
      (response) =>
        response.request().headers().rsc === "1" &&
        new URL(response.url()).pathname === "/app/receipts",
    );
    await setHidden(page, false);
    await refreshed;
    await expect(search).toHaveValue("Corner");
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });
});
