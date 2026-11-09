import { expect, test } from "@playwright/test";
import { PASSWORD, uniqueEmail } from "./helpers";

// Needs a build with NEXT_PUBLIC_TURNSTILE_SITE_KEY set and a server with TURNSTILE_SECRET_KEY:
// `scripts/test.sh --turnstile` does both with Cloudflare's test keys. E2E_TURNSTILE says which
// secret the server runs with: "pass" (always passes) or "fail" (always rejects).
const mode = process.env.E2E_TURNSTILE;

test.describe("with Turnstile on and a passing secret", () => {
  test.skip(mode !== "pass", "E2E_TURNSTILE=pass only");

  test("sign-up waits for the check, then creates the account", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("E2E User");
    await page.getByLabel("Email").fill(uniqueEmail("turnstile"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await expect(page.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app(\/|\?|$)/);
  });

  test("the forgot-password form passes the check too", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(uniqueEmail("turnstile-forgot"));
    await expect(page.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
  });

  test("a submit before the check finishes says to wait instead of calling the server", async ({
    page,
  }) => {
    // Hold Cloudflare's script back so no token can arrive.
    await page.route("**/challenges.cloudflare.com/turnstile/v0/api.js*", (route) => route.abort());
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(uniqueEmail("turnstile-early"));
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("main").getByRole("alert").first()).toContainText(/security check/);
  });

  test("the support form's message gets past the check", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Contact support" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
    await dialog.getByLabel("Name", { exact: true }).fill("E2E Visitor");
    await dialog.getByLabel("Email", { exact: true }).fill(uniqueEmail("turnstile-contact"));
    await dialog.getByLabel("Message").fill("Does the contact form pass the check?");
    await expect(dialog.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    const reply = page.waitForResponse("**/api/contact");
    await dialog.getByRole("button", { name: "Send message" }).click();
    // No mailer here, and a production build won't pretend delivery: 503 means the check passed
    // and only sending failed (a missing or rejected token would be 400 or 403).
    expect((await reply).status()).toBe(503);
    await expect(dialog.getByRole("alert")).not.toContainText("security check");
  });

  test("the product updates form passes the check and asks the visitor to check their inbox", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Hear when something new ships" });
    await section.getByLabel("Email address").fill(uniqueEmail("turnstile-updates"));
    await expect(section.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    await section.getByRole("button", { name: "Subscribe" }).click();
    await expect(section.getByRole("status")).toContainText("Check your inbox");
  });

  test("the server refuses requests that carry no token", async ({ request, baseURL }) => {
    const signUp = await request.post("/api/auth/sign-up/email", {
      data: { name: "Bot", email: uniqueEmail("turnstile-bot"), password: PASSWORD },
    });
    expect(signUp.status()).toBe(400);
    expect(await signUp.json()).toMatchObject({ code: "MISSING_RESPONSE" });

    const contact = await request.post("/api/contact", {
      headers: { origin: baseURL! },
      data: { name: "Bot", email: uniqueEmail("turnstile-bot"), message: "Hello there, bot" },
    });
    expect(contact.status()).toBe(400);

    const updates = await request.post("/api/newsletter/subscribe", {
      headers: { origin: baseURL! },
      data: { email: uniqueEmail("turnstile-bot") },
    });
    expect(updates.status()).toBe(400);
  });
});

test.describe("with Turnstile on and a rejecting secret", () => {
  test.skip(mode !== "fail", "E2E_TURNSTILE=fail only");

  test("sign-up explains that the security check failed and creates no account", async ({
    page,
  }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("E2E User");
    await page.getByLabel("Email").fill(uniqueEmail("turnstile-fail"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await expect(page.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "The security check failed",
    );
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("the product updates form shows the same error", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Hear when something new ships" });
    await section.getByLabel("Email address").fill(uniqueEmail("turnstile-fail-updates"));
    await expect(section.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    await section.getByRole("button", { name: "Subscribe" }).click();
    await expect(section.getByRole("alert")).toContainText("The security check failed");
  });

  test("the support form shows the same error", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Contact support" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("E2E Visitor");
    await dialog.getByLabel("Email", { exact: true }).fill(uniqueEmail("turnstile-fail-contact"));
    await dialog.getByLabel("Message").fill("This should be turned away.");
    await expect(dialog.locator('[data-turnstile="ready"]')).toBeAttached({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Send message" }).click();
    await expect(dialog.getByRole("alert")).toContainText("The security check failed");
  });
});
