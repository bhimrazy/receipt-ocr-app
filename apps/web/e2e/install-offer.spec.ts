import { expect, test, type Page } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

// Playwright can't make Chrome fire a real `beforeinstallprompt`; a synthetic one with the same
// shape goes through the same listener.
async function offerInstall(page: Page, outcome: "accepted" | "dismissed" = "dismissed") {
  await page.evaluate((outcome) => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        const w = window as unknown as { __prompts?: number };
        w.__prompts = (w.__prompts ?? 0) + 1;
      },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

const prompts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __prompts?: number }).__prompts ?? 0);
const card = (page: Page) => page.getByRole("complementary", { name: "Install ReceiptOCR" });

test("the install card waits for a read receipt, and Not now snoozes it", async ({ page }) => {
  const email = uniqueEmail("install-card");
  await signUp(page, email);
  await offerInstall(page);
  // Never on the first visit to /app, even with Chrome's prompt in hand.
  await expect(page.getByRole("button", { name: "Add receipt photos or PDFs" })).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  const [id] = await seedReceipts(email, ["Corner Shop"]);
  await page.goto(`/app/receipts/${id}`);
  await offerInstall(page);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole("button", { name: "Not now" }).click();
  await expect(card(page)).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem("receiptocr.install"));
  expect(JSON.parse(stored!).app.dismissals).toBe(1);

  await page.reload();
  await offerInstall(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("Settings and the account menu offer Install app only when the browser can install", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("install-row"));
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "App", exact: true })).toHaveCount(0);

  await offerInstall(page);
  await expect(page.getByRole("heading", { name: "App", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Install app" }).click();
  await expect.poll(() => prompts(page)).toBe(1);
  // Chrome gives one prompt per page load; once used, the row goes until the next one.
  await expect(page.getByRole("heading", { name: "App", exact: true })).toHaveCount(0);

  await offerInstall(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Install app" }).click();
  await expect.poll(() => prompts(page)).toBe(2);
});

test("the home page lists Get the app only where the browser can install, with no sheet on desktop", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(footer.getByRole("button", { name: "Get the app" })).toHaveCount(0);

  await offerInstall(page);
  await footer.getByRole("button", { name: "Get the app" }).click();
  await expect.poll(() => prompts(page)).toBe(1);
  await expect(page.getByRole("complementary", { name: "Install the app" })).toHaveCount(0);
});

test.describe("on iPhone Safari", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    hasTouch: true,
  });

  test("Install app in Settings opens the Add to Home Screen guide", async ({ page }) => {
    await signUp(page, uniqueEmail("install-ios"));
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Install app" }).click();
    const guide = page.getByRole("dialog", { name: "Add ReceiptOCR to your Home Screen" });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("Add to Home Screen");
    await expect(guide).toContainText("Open as Web App");
    // Modal: Tab past the last control wraps inside the sheet. Base UI's focus guards move focus
    // on the next frame, so the check polls.
    await guide.getByRole("button", { name: "Done" }).focus();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      await expect
        .poll(() => guide.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true);
    }
    await guide.getByRole("button", { name: "Done" }).click();
    await expect(guide).toHaveCount(0);
  });
});

test.describe("on an Android phone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test("the home page sheet waits for a scroll to How it works, and Escape means Not now", async ({
    page,
  }) => {
    await page.goto("/");
    await offerInstall(page);
    const sheet = page.getByRole("complementary", { name: "Install the app" });
    await page.waitForTimeout(500);
    await expect(sheet).toHaveCount(0);

    await page.locator("#how").scrollIntoViewIfNeeded();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Install ReceiptOCR on your phone");
    // It never takes focus.
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(false);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    const stored = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("receiptocr.install")))!,
    );
    expect(stored.landing.shows).toBe(1);
    expect(stored.landing.until).toBeTruthy();
  });
});
