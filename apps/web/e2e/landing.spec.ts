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

test("the support form starts from a signed-in visitor's name and email, both editable", async ({
  page,
}) => {
  const email = uniqueEmail("support-prefill");
  await signUp(page, email);
  await page.goto("/");
  await page.getByRole("button", { name: "Contact support" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("E2E User");
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(dialog.getByLabel("Message")).toBeFocused();
  await dialog.getByLabel("Name", { exact: true }).fill("Someone Else");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Someone Else");
});

test("a failed support panel chunk shows a fallback with retry instead of breaking the page", async ({
  page,
}) => {
  await page.goto("/privacy");
  // Everything the page needs is loaded; only the lazy panel chunk is fetched after this.
  let failing = true;
  await page.route(/\/_next\/static\/.*\.js/, (route) =>
    failing ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "Contact support" }).click();
  await expect(page.getByText("Couldn't load the form")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel(/email/i).first()).toBeVisible();
});

test("the landing pricing shows three plans and Custom opens the support form", async ({
  page,
}) => {
  await page.goto("/#pricing");
  const pricing = page.locator("#pricing");
  for (const name of ["Free", "Pro", "Custom"]) {
    await expect(pricing.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(pricing.getByText("1 workspace", { exact: true })).toHaveCount(0);
  await pricing.getByRole("button", { name: "Contact us" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Plans & limits" }),
  ).toHaveAttribute("aria-pressed", "true");
});
