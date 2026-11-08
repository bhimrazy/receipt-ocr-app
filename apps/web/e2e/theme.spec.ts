import { expect, test, type Page } from "@playwright/test";

// Records whether <html> already had `.light` when <body> was parsed, i.e. before the first paint.
async function watchFirstPaint(page: Page, stored?: string) {
  await page.addInitScript((value) => {
    if (value) localStorage.setItem("theme", value);
    const record = () => {
      if (!document.body || "themeAtBody" in window) return false;
      (window as unknown as { themeAtBody: boolean }).themeAtBody =
        document.documentElement.classList.contains("light");
      return true;
    };
    if (!record()) {
      const observer = new MutationObserver(() => record() && observer.disconnect());
      observer.observe(document, { childList: true, subtree: true });
    }
  }, stored);
}

const themeAtBody = (page: Page) =>
  page.evaluate(() => (window as unknown as { themeAtBody?: boolean }).themeAtBody);

const backgroundOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const firstThemeColor = (page: Page) =>
  page.locator('meta[name="theme-color"]').first().getAttribute("content");

for (const colorScheme of ["dark", "light"] as const) {
  test(`with no choice stored, a ${colorScheme} OS still gets dark`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await watchFirstPaint(page);
    await page.goto("/");
    expect(await themeAtBody(page)).toBe(false);
    await expect(page.locator("html")).not.toHaveClass(/\blight\b/);
    expect(await backgroundOf(page)).toBe("rgb(10, 10, 11)");
    expect(await firstThemeColor(page)).toBe("#0a0a0b");
  });
}

for (const colorScheme of ["dark", "light"] as const) {
  test(`the light key gives light before the first paint on a ${colorScheme} OS`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await watchFirstPaint(page, "light");
    await page.goto("/sign-in");
    expect(await themeAtBody(page)).toBe(true);
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    expect(await backgroundOf(page)).toBe("rgb(247, 247, 248)");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      "light",
    );
    expect(await firstThemeColor(page)).toBe("#f7f7f8");
  });
}

test("the dark key on a light OS stays dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await watchFirstPaint(page, "dark");
  await page.goto("/");
  expect(await themeAtBody(page)).toBe(false);
  expect(await backgroundOf(page)).toBe("rgb(10, 10, 11)");
});
