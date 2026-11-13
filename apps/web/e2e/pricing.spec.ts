import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// The e2e stack has Paddle's sandbox keys under `next start` (production), the live site's state:
// the public pages say Pro opens soon and only platform admins can check out (upgrade.spec.ts).

test("pricing shows Free, Pro and Custom with a monthly/yearly switch, and the FAQ", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Start free");
  await expect(page.getByRole("heading", { name: "Free", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
  // Numbers come from the saved plan table; admin.spec.ts changes it for a moment, so match the shape.
  await expect(
    page.getByText(/^\d+ scans a month shared by the workspace, up to \d+ a day$/),
  ).toBeVisible();
  await expect(page.getByText(/^\d+ scans a day and \d+ a month for each member$/)).toBeVisible();
  await expect(page.getByText(/^Up to \d+ members?$/)).toHaveCount(2);
  await expect(page.getByText(/^\d+ workspaces? to own$/)).toBeVisible();
  await expect(
    page.getByText(/^Own up to \d+ workspaces \(each upgraded separately\)$/),
  ).toBeVisible();
  // Pro states one workspace rule, not "1 workspace" next to "Own up to 2".
  await expect(page.getByText("1 workspace", { exact: true })).toHaveCount(0);
  // Pro's list starts from Free.
  await expect(page.getByText("Everything in Free", { exact: true })).toBeVisible();

  // Custom has no price; its button opens the support form on "Plans & limits".
  await expect(page.getByRole("heading", { name: "Custom", exact: true })).toBeVisible();
  await expect(page.getByText("Let's talk", { exact: true })).toBeVisible();
  await expect(page.getByText(/^More scans, members or workspaces/)).toBeVisible();
  await page.getByRole("button", { name: "Contact us" }).first().click();
  const form = page.getByRole("dialog");
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Plans & limits" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();

  // Monthly is the default; the switch is a native radio group.
  await expect(page.getByRole("radio", { name: /Monthly/ })).toBeChecked();
  await expect(page.getByText("$9", { exact: true })).toBeVisible();
  // The radio is visually hidden inside its label, which is what people click.
  await page.locator("label", { hasText: "Yearly" }).click();
  await expect(page.getByRole("radio", { name: /Yearly/ })).toBeChecked();
  await expect(page.getByText("$90", { exact: true })).toBeVisible();

  // Pro is not open to everyone in this stack: no checkout link, no Paddle script, Free leads.
  await expect(page.getByRole("link", { name: /Get Pro/ })).toHaveCount(0);
  await expect(page.getByText("Opens soon", { exact: true })).toBeVisible();
  await expect(page.getByText("Your plan", { exact: true })).toHaveCount(0);
  expect(await page.locator('script[src*="paddle.com"]').count()).toBe(0);

  const faq = page.getByText("Plans are per workspace. What does that mean?");
  await faq.click();
  await expect(page.getByText(/A Pro subscription covers exactly one workspace/)).toBeVisible();
  await page.getByText("Can I get a refund?").click();
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

test("billing settings show the plan without a checkout while Pro is closed to the viewer", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("billing"));
  await page.goto("/app/settings/billing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan and billing");
  const main = page.locator("#main-content");
  await expect(main.getByText("Opens soon", { exact: true })).toBeVisible();
  await expect(main.getByText("Your plan", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: /Upgrade to Pro/ })).toHaveCount(0);
  await expect(main.getByText(/^\d+ \/ \d+ scans$/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Compare plans" })).toHaveAttribute(
    "href",
    "/pricing",
  );
});

test("a signed-in visitor sees their plan marked on pricing", async ({ page }) => {
  await signUp(page, uniqueEmail("pricing-signed-in"));
  await page.goto("/pricing");
  const free = page.locator("div", {
    has: page.getByRole("heading", { name: "Free", exact: true }),
  });
  await expect(free.getByText("Your plan", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the app" }).first()).toBeVisible();
});
