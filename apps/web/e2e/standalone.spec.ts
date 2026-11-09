import { expect, test } from "@playwright/test";
import { emulateStandalone, signUp, uniqueEmail } from "./helpers";

test("a browser tab still gets the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-display-mode", "standalone");
});

test.describe("installed app", () => {
  test.beforeEach(({ page }) => emulateStandalone(page));

  test("signed out, / opens sign-in, and the auth screens don't link to the website", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("link", { name: "ReceiptOCR home" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeHidden();
    await expect(page.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
  });

  test("a client-side link to / goes to sign-in, not the landing page", async ({ page }) => {
    await page.goto("/no-such-page");
    await page.getByRole("main").getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("signed in, / opens the app; legal pages go Back; sign-out lands on sign-in", async ({
    page,
  }) => {
    await signUp(page, uniqueEmail("standalone"));
    await page.goto("/");
    await expect(page).toHaveURL(/\/app$/);

    await page.goto("/app/settings");
    await page.getByRole("link", { name: "Terms", exact: true }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("link", { name: "Back to home" })).toBeHidden();
    await expect(page.getByRole("contentinfo")).toBeHidden();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);

    // Opened first, with nothing to go back to: Settings.
    const fresh = await page.context().newPage();
    await emulateStandalone(fresh);
    await fresh.goto("/privacy");
    await fresh.getByRole("button", { name: "Back", exact: true }).click();
    await expect(fresh).toHaveURL(/\/app\/settings$/);
    await fresh.close();

    await page.goto("/pricing");
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: /Open the app/ })).toBeHidden();
    await expect(header.getByRole("link", { name: "ReceiptOCR home" })).toBeHidden();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
