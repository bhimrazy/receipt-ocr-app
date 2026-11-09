import { expect, test, type Page } from "@playwright/test";

const screens = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password?token=e2e-unused"];

/** Box styles of every element between <main> and the page's h1: where a card would show. */
function chromeAroundHeading(page: Page) {
  return page
    .locator("main h1")
    .first()
    .evaluate((heading) => {
      const boxes = [];
      for (
        let node = heading.parentElement;
        node && node.tagName !== "MAIN";
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        boxes.push({
          shadow: style.boxShadow,
          border: style.borderTopWidth,
          background: style.backgroundColor,
        });
      }
      return boxes;
    });
}

const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`at 390 px, ${colorScheme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme });

    for (const path of screens) {
      test(`${path} fills the screen with no card and no sideways scroll`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("main h1").first()).toBeVisible();
        // Centred like the logo and buttons around it.
        await expect(page.locator("main h1").first()).toHaveCSS("text-align", "center");
        for (const box of await chromeAroundHeading(page)) {
          expect(box).toEqual({ shadow: "none", border: "0px", background: "rgba(0, 0, 0, 0)" });
        }
        expect(await hasHorizontalScroll(page)).toBe(false);
        // 16 px or more, or iOS zooms the page when a field takes focus.
        const sizes = await page
          .locator("main input:visible")
          .evaluateAll((inputs) =>
            inputs.map((input) => parseFloat(getComputedStyle(input).fontSize)),
          );
        for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
        // A browser tab keeps the website footer.
        const footer = page.getByRole("contentinfo");
        await expect(footer.getByRole("link", { name: "Home", exact: true })).toBeVisible();
        await expect(footer.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
      });
    }
  });
}

test("at 1440 px sign-in keeps its card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const boxes = await chromeAroundHeading(page);
  expect(boxes.some((box) => box.shadow !== "none")).toBe(true);
  await expect(page.locator("main h1").first()).toHaveCSS("text-align", "left");
});
