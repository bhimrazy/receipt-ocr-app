import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// Records whether <html> already had `.light` when <body> was parsed, i.e. before the first paint.
async function watchFirstPaint(page: Page, stored?: string) {
  await page.addInitScript((value) => {
    if (value && !sessionStorage.getItem("seeded")) {
      localStorage.setItem("theme", value);
      sessionStorage.setItem("seeded", "1");
    }
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

const LIGHT_BG = "rgb(247, 247, 248)";
const DARK_BG = "rgb(10, 10, 11)";

/** The theme-color the browser uses: the first one whose media matches. */
const activeThemeColor = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
        (m) => !m.media || matchMedia(m.media).matches,
      )?.content,
  );

const html = (page: Page) => page.locator("html");
const footerToggle = (page: Page) =>
  page.getByRole("contentinfo").getByRole("radiogroup", { name: "Theme" });

test.describe("before the first paint", () => {
  const cases = [
    { os: "light", stored: undefined, light: true, color: "#f7f7f8" },
    { os: "dark", stored: undefined, light: false, color: "#0a0a0b" },
    { os: "dark", stored: "light", light: true, color: "#f7f7f8" },
    { os: "light", stored: "dark", light: false, color: "#0a0a0b" },
  ] as const;
  for (const { os, stored, light, color } of cases) {
    test(`a ${os} OS with ${stored ?? "no choice"} stored gets ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: os });
      await watchFirstPaint(page, stored);
      await page.goto("/sign-in");
      expect(await themeAtBody(page)).toBe(light);
      expect(await backgroundOf(page)).toBe(light ? LIGHT_BG : DARK_BG);
      expect(
        await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
      ).toBe(light ? "light" : "dark");
      expect(await activeThemeColor(page)).toBe(color);
    });
  }
});

test("on System the page follows the OS as it changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(html(page)).not.toHaveClass(/\blight\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveClass(/\blight\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).not.toHaveClass(/\blight\b/);
});

test("the footer toggle switches, persists, reaches other tabs and returns to System", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const toggle = footerToggle(page);
  await expect(toggle.getByRole("radio", { name: "System" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "dark" });
  await other.goto("/pricing");

  await toggle.getByRole("radio", { name: "Light" }).click();
  await expect(html(page)).toHaveClass(/\blight\b/);
  expect(await backgroundOf(page)).toBe(LIGHT_BG);
  expect(await activeThemeColor(page)).toBe("#f7f7f8");
  await expect(html(other)).toHaveClass(/\blight\b/);

  await page.reload();
  await expect(html(page)).toHaveClass(/\blight\b/);
  await expect(footerToggle(page).getByRole("radio", { name: "Light" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await footerToggle(page).getByRole("radio", { name: "System" }).click();
  await expect(html(page)).not.toHaveClass(/\blight\b/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
  await expect(html(other)).not.toHaveClass(/\blight\b/);
});

test("the toggle works from the keyboard with a visible focus ring", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  const toggle = footerToggle(page);
  const system = toggle.getByRole("radio", { name: "System" });
  await expect(system).toHaveAttribute("aria-checked", "true");
  // One tab stop for the group: the checked segment.
  await expect(toggle.locator('[tabindex="0"]')).toHaveCount(1);

  await system.focus();
  await page.keyboard.press("ArrowRight");
  const light = toggle.getByRole("radio", { name: "Light" });
  await expect(light).toBeFocused();
  await expect(light).toHaveAttribute("aria-checked", "true");
  await expect(html(page)).toHaveClass(/\blight\b/);
  // The focus ring is --ring (light: #036c4d), on top of the selected segment's edge.
  expect(await light.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("rgb(3, 108, 77)");

  await page.keyboard.press("End");
  await expect(toggle.getByRole("radio", { name: "Dark" })).toBeFocused();
  await expect(html(page)).not.toHaveClass(/\blight\b/);
  await page.keyboard.press("ArrowRight");
  await expect(system).toBeFocused();
});

test("Settings › Appearance and the account menu set the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUp(page, uniqueEmail("theme"));
  await page.goto("/app/settings");
  const appearance = page.getByRole("radiogroup", { name: "Appearance" });
  await appearance.getByRole("radio", { name: "Light" }).click();
  await expect(html(page)).toHaveClass(/\blight\b/);

  await page.getByRole("button", { name: "Account menu" }).click();
  const dark = page.getByRole("menuitemradio", { name: "Dark" });
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toBeChecked();
  await dark.click();
  await expect(html(page)).not.toHaveClass(/\blight\b/);
  await expect(dark).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(appearance.getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
