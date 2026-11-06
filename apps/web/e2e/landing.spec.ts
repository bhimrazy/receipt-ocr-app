import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

const header = (page: import("@playwright/test").Page) => page.locator("header");

test("the landing header offers the app to signed-in visitors and sign-in to others", async ({
  page,
}) => {
  await page.goto("/");
  await expect(header(page).getByRole("link", { name: "Get started free" })).toBeVisible();
  await expect(header(page).getByRole("link", { name: "Open the app" })).toHaveCount(0);

  await signUp(page, uniqueEmail("landing"));
  await page.goto("/");
  await expect(header(page).getByRole("link", { name: /Open the app/ })).toBeVisible();
});

test("a stale hint without a session lands on sign-in and is cleared", async ({
  context,
  page,
  baseURL,
}) => {
  await context.addCookies([{ name: "signed_in_hint", value: "1", url: baseURL! }]);
  await page.goto("/");
  await header(page)
    .getByRole("link", { name: /Open the app/ })
    .click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await context.cookies()).find((c) => c.name === "signed_in_hint")).toBeUndefined();
});

test("lab design pages are not served in a normal build", async ({ page }) => {
  const res = await page.goto("/landing-a");
  expect(res?.status()).toBe(404);
});
