import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// The e2e stack has no PADDLE_* settings, so billing is off: prices show, no checkout runs.

test("pricing shows Free and Pro with a monthly/yearly switch, and the FAQ", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Start free");
  await expect(page.getByRole("heading", { name: "Free", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
  // Numbers come from the saved plan table; admin.spec.ts changes it for a moment, so match the shape.
  await expect(
    page.getByText(
      /^\d+ scans a month, up to \d+ a day, for the workspace, shared by its members$/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/^\d+ scans a day, up to \d+ a month, per person$/)).toBeVisible();
  await expect(page.getByText(/Up to 2 workspaces to own/)).toBeVisible();

  // Yearly is the default; the switch is a native radio group.
  await expect(page.getByText("$90", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Monthly/ }).check();
  await expect(page.getByText("$9", { exact: true })).toBeVisible();

  // Billing is off in this stack: no checkout link, no Paddle script.
  await expect(page.getByRole("link", { name: /Get Pro/ })).toHaveCount(0);
  await expect(page.getByText("Pro checkout opens soon.")).toBeVisible();
  expect(await page.locator('script[src*="paddle.com"]').count()).toBe(0);

  const faq = page.getByText("Plans are per workspace. What does that mean?");
  await faq.click();
  await expect(page.getByText(/A Pro subscription covers exactly one workspace/)).toBeVisible();
  await expect(page.getByRole("link", { name: "refund policy" })).toHaveAttribute(
    "href",
    "/refunds",
  );
});

test("the footer links Pricing and Refunds, and refunds names Paddle", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
  await footer.getByRole("link", { name: "Refunds" }).click();
  await expect(page).toHaveURL(/\/refunds$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Refund policy");
  await expect(page.getByText(/Paddle.com is our reseller/)).toBeVisible();
});

test("billing settings show the plan without a checkout while billing is off", async ({ page }) => {
  await signUp(page, uniqueEmail("billing"));
  await page.goto("/app/settings/billing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Billing");
  await expect(page.getByText(/Paid plans aren.t open yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Upgrade to Pro/ })).toHaveCount(0);
  await expect(page.locator("#main-content").getByText("/ 100 this month")).toBeVisible();
});
