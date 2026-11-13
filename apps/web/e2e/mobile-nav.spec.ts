import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

// Phone shell: tab bar, app bar with Back, account and receipt-action sheets.
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
test.use(phone);

// One account for the file: sign-up is rate-limited per client.
test.describe.configure({ mode: "serial" });
const email = uniqueEmail("mobile");
let session: BrowserContextOptions["storageState"];
let receiptId = "";

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    ...phone,
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
  });
  const page = await context.newPage();
  await signUp(page, email);
  [receiptId = ""] = await seedReceipts(email, ["Phone Market"]);
  session = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(session) });

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

test("tab bar moves between sections and marks the active one", async ({ page }) => {
  await page.goto("/app");
  const tabs = tabBar(page);
  await expect(tabs).toBeVisible();
  // The desktop sidebar's account menu is not shown on a phone.
  await expect(page.getByRole("button", { name: "Account menu" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Add receipts" })).toBeHidden();

  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Scan" })).toHaveAttribute(
    "href",
    "/app/upload?capture=1",
  );

  await tabs.getByRole("link", { name: "Receipts" }).click();
  await expect(page).toHaveURL(/\/app\/receipts$/);
  await expect(tabs.getByRole("link", { name: "Receipts" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  await expectNoSideScroll(page);

  await tabs.getByRole("link", { name: "Spending" }).click();
  await expect(page).toHaveURL(/\/app\/spending$/);
  await expect(tabs.getByRole("link", { name: "Spending" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: "Receipts" })).not.toHaveAttribute("aria-current");
  await expectNoSideScroll(page);

  await tabs.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(tabs.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectNoSideScroll(page);

  await expect(tabs.getByRole("link")).toHaveText([
    "Home",
    "Receipts",
    "Scan",
    "Spending",
    "Settings",
  ]);
  // Every tab is at least 44px tall.
  for (const name of ["Home", "Receipts", "Scan", "Spending", "Settings"]) {
    const box = await tabs.getByRole("link", { name }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("Back returns from a receipt to Receipts", async ({ page }) => {
  const id = receiptId;
  await page.goto("/app/receipts");
  await page.getByRole("link", { name: "Phone Market" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/receipts/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Phone Market" })).toBeVisible();
  // A receipt belongs to Receipts in the tab bar.
  await expect(tabBar(page).getByRole("link", { name: "Receipts" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectNoSideScroll(page);

  await page.getByRole("link", { name: "Back to Receipts" }).click();
  await expect(page).toHaveURL(/\/app\/receipts$/);

  // Opened directly (no list behind it), Back still lands on Receipts.
  await page.goto(`/app/receipts/${id}`);
  await page.getByRole("link", { name: "Back to Receipts" }).click();
  await expect(page).toHaveURL(/\/app\/receipts$/);
});

test("Back is named for the page you came from", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("link", { name: "Phone Market" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/receipts/${receiptId}$`));
  await page.getByRole("link", { name: "Back to Home" }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("account sheet opens, and closes with Escape or a tap outside", async ({ page }) => {
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Account and workspace" });
  const sheet = page.getByRole("dialog", { name: "E2E User" });

  await trigger.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Workspace" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cookie settings" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(sheet).toBeVisible();
  // The backdrop above the sheet.
  await page.mouse.click(195, 60);
  await expect(sheet).toBeHidden();
});

test("Groups sits under Receipts, reached from Settings", async ({ page }) => {
  await page.goto("/app/settings");
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Groups" })
    .click();
  await expect(page).toHaveURL(/\/app\/receipts\/groups$/);
  await expect(tabBar(page).getByRole("link", { name: "Groups" })).toHaveCount(0);
  await expect(tabBar(page).getByRole("link", { name: "Receipts" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Back to Settings" })).toBeVisible();

  await page.goto("/app/receipts/groups");
  await page.getByRole("link", { name: "Back to Receipts" }).click();
  await expect(page).toHaveURL(/\/app\/receipts$/);
});

test("the old History and Groups URLs are gone", async ({ page }) => {
  for (const path of ["history", "groups"].map((old) => `/app/${old}`)) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("receipt actions sheet offers edit, export and delete", async ({ page }) => {
  await page.goto(`/app/receipts/${receiptId}`);
  await page.getByRole("button", { name: "Receipt actions" }).click();
  const sheet = page.getByRole("dialog", { name: "Phone Market" });
  await expect(sheet).toBeVisible();
  for (const name of ["Edit details", "Export CSV", "Copy JSON", "Delete receipt"]) {
    const row = sheet.getByRole("button", { name });
    await expect(row).toBeVisible();
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: "Receipt actions" }).click();
  await sheet.getByRole("button", { name: "Edit details" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByLabel("Merchant", { exact: true })).toBeFocused();
});

test("Delete moves focus from the sheet to the confirm dialog", async ({ page }) => {
  await page.goto(`/app/receipts/${receiptId}`);
  await page.getByRole("button", { name: "Receipt actions" }).click();
  await page
    .getByRole("dialog", { name: "Phone Market" })
    .getByRole("button", { name: "Delete receipt" })
    .click();
  await expect(page.getByRole("button", { name: "Keep receipt" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Receipt actions" })).toBeFocused();
});

test("a pressed button changes colour; chrome is unselectable, receipt data is not", async ({
  page,
}) => {
  await page.goto("/app/settings");
  const seePlans = page.getByRole("link", { name: /^Plan and billing/ });
  const bg = () => seePlans.evaluate((el) => getComputedStyle(el).backgroundColor);
  const resting = await bg();
  const box = (await seePlans.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(bg).not.toBe(resting);
  await page.mouse.up();

  const userSelect = (loc: ReturnType<Page["locator"]>) =>
    loc.evaluate((el) => getComputedStyle(el).userSelect);
  expect(await userSelect(tabBar(page).getByRole("link").first())).toBe("none");

  await page.goto("/app/receipts");
  const row = page.getByRole("list").getByRole("listitem").filter({ hasText: "Phone Market" });
  await expect(row).toBeVisible();
  expect(await userSelect(row.locator("span.font-mono"))).not.toBe("none");
});

test("Settings is a grouped list of rows that open their page or a sheet", async ({ page }) => {
  await page.goto("/app/settings");
  const list = page.getByRole("navigation", { name: "Settings" });
  await expect(
    list.getByRole("link", { name: /^Plan and billing Free · \d+ \/ \d+ scans$/ }),
  ).toBeVisible();
  await expect(list.getByRole("link", { name: /^Workspace / })).toBeVisible();
  await expect(list.getByRole("link", { name: "Security Set up" })).toBeVisible();
  // The long sections those rows replace are desktop-only; the rest stay.
  await expect(page.getByRole("heading", { name: "Plan and billing" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Receipt scanning" })).toBeVisible();
  await expectNoSideScroll(page);
  for (const row of await list.getByRole("listitem").all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  const appearance = list.getByRole("button", { name: "Appearance System" });
  await appearance.click();
  const sheet = page.getByRole("dialog", { name: "Appearance" });
  await sheet.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await page.keyboard.press("Escape");
  await expect(list.getByRole("button", { name: "Appearance Light" })).toBeFocused();
  await list.getByRole("button", { name: "Appearance Light" }).click();
  await page
    .getByRole("dialog", { name: "Appearance" })
    .getByRole("radio", { name: "System" })
    .click();
  await page.keyboard.press("Escape");

  await list.getByRole("link", { name: "Security Set up" }).click();
  await expect(page).toHaveURL(/\/app\/settings\/security$/);
});

/** Records the animations of each view transition React starts, by pseudo-element and name. */
async function recordViewTransitions(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __vt: string[] }).__vt = seen;
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
      const transition = start(arg);
      void transition.ready.then(() => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect as KeyframeEffect | null;
          if (!effect?.pseudoElement?.startsWith("::view-transition")) continue;
          const name = (animation as CSSAnimation).animationName;
          seen.push(`${effect.pseudoElement} ${name} ${effect.getComputedTiming().duration}`);
        }
      });
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vt: string[] }).__vt);

// TODO(2026-11-16): re-enable with PushedScreen's transition.
test.skip("a receipt slides in from Receipts and back out, fast", async ({ page }) => {
  await recordViewTransitions(page);
  await page.goto("/app/receipts");
  await page.getByRole("link", { name: "Phone Market" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/receipts/${receiptId}`));
  await expect
    .poll(() => transitions(page))
    .toContainEqual(expect.stringMatching(/new\(.+\) push-in 200$/));

  await page.getByRole("link", { name: "Back to Receipts" }).click();
  await expect(page).toHaveURL(/\/app\/receipts$/);
  await expect
    .poll(() => transitions(page))
    .toContainEqual(expect.stringMatching(/old\(.+\) push-in 160$/));
});

test("leaving a receipt for Home shows Home, not its loading skeletons", async ({ page }) => {
  await page.goto(`/app/receipts/${receiptId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Phone Market" })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('main [data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("pushing a receipt moves nothing", async ({ page }) => {
    await recordViewTransitions(page);
    await page.goto("/app/receipts");
    await page.getByRole("link", { name: "Phone Market" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/receipts/${receiptId}`));
    await expect(page.getByRole("heading", { level: 1, name: "Phone Market" })).toBeVisible();
    // React still starts a transition; nothing in it may take time.
    expect((await transitions(page)).filter((t) => !t.endsWith(" 0"))).toEqual([]);
  });
});
