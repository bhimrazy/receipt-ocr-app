import { expect, test } from "@playwright/test";

// Default build: no GA measurement id, so nothing needs consent and no banner shows.
test.skip(Boolean(process.env.E2E_GA), "default build only");

test("without GA there is no banner, and the footer still opens cookie settings", async ({
  page,
}) => {
  const google: string[] = [];
  page.on("request", (r) => {
    if (/google(tagmanager|-analytics)\.com/.test(r.url())) google.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Customise" })).toHaveCount(0);

  const settings = page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" });
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(dialog).toContainText("only necessary cookies");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
  expect(google).toEqual([]);
});

test("the cookie policy lists what the app stores", async ({ page }) => {
  await page.goto("/cookies");
  await expect(page.getByRole("heading", { level: 1, name: "Cookie policy" })).toBeVisible();
  for (const name of ["better-auth.session_token", "signed_in_hint", "consent"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  // GA isn't configured in this build, so its cookies aren't listed.
  await expect(page.getByText("_ga", { exact: true })).toHaveCount(0);
  await page.goto("/privacy");
  await expect(page.getByRole("link", { name: "Cookie policy" })).toHaveAttribute(
    "href",
    "/cookies",
  );
});
