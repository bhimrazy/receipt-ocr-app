import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { totpFromBase32 } from "../lib/totp";

export const PASSWORD = "e2e-password-123";

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/**
 * Sign-up is limited to 3 per minute per client IP, and playwright.config.ts gives each worker
 * one IP. A worker that runs a fourth signing-up test inside a minute is told "Too many attempts"
 * and the page stays on /sign-up (the flake seen on several PRs). Each sign-up gets its own
 * address instead. Specs that test the limit itself don't use this helper.
 */
async function giveFreshClientIp(page: Page) {
  const ip = `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

/** Typing before React hydrates is lost and a submit reloads the page; the form flags when it is ready. */
export async function waitForAuthForm(page: Page) {
  await page.locator("form[data-ready='true']").waitFor();
}

export async function signUp(page: Page, email: string) {
  await giveFreshClientIp(page);
  await page.goto("/sign-up");
  await waitForAuthForm(page);
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app(\/|\?|$)/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await waitForAuthForm(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app(\/|\?|$)/);
}

/** Inserts receipts straight into Postgres for the user's personal workspace (no OCR involved). */
export async function seedReceipts(email: string, merchants: string[]) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [owner] = await sql<{ user_id: string; organization_id: string }[]>`
      select u.id as user_id, m.organization_id
      from "user" u join member m on m.user_id = u.id
      where u.email = ${email} limit 1`;
    if (!owner) throw new Error(`no workspace for ${email}`);
    const ids: string[] = [];
    for (const merchant of merchants) {
      const [row] = await sql<{ id: string }[]>`
        insert into receipts (organization_id, user_id, merchant, receipt_date, category,
                              currency, subtotal, tax, total, confidence, status)
        values (${owner.organization_id}, ${owner.user_id}, ${merchant}, '2026-10-01', 'Groceries',
                'USD', 10.00, 0.80, 10.80, 0.95, 'completed')
        returning id`;
      await sql`insert into receipt_items (receipt_id, name, quantity, unit_price, total_price)
                values (${row!.id}, 'Test item', 1, 10.00, 10.00)`;
      ids.push(row!.id);
    }
    return ids;
  } finally {
    await sql.end();
  }
}

/** The code an authenticator app would show now for a base32 key (RFC 6238, as the app uses). */
export const totpCode = (key: string) => totpFromBase32(key);

/**
 * Adding a factor asks for a fresh check, which for an account with no factor is an emailed code.
 * The e2e build has no mailer, so the check is recorded on the user's sessions directly, as if it
 * had passed. Integration tests cover the emailed code itself.
 */
export async function markSteppedUp(email: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update session set step_up_at = now(), step_up_method = 'email'
              where user_id = (select id from "user" where email = ${email})`;
  } finally {
    await sql.end();
  }
}

/**
 * Turns on two-step sign-in from Settings → Security the way a person does: password, read the
 * manual key off the page, enter a code, tick "saved" for the backup codes. Returns the key and
 * the backup codes.
 */
export async function enrolAuthenticator(page: Page, email: string) {
  await markSteppedUp(email);
  await page.goto("/app/settings/security");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  await page.getByLabel(/Confirm your password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  const key = (await page.getByTestId("totp-key").textContent())!.replace(/\s/g, "");
  await page.getByLabel("Enter the 6-digit code it shows").fill(totpFromBase32(key));
  await page.getByRole("button", { name: "Turn on" }).click();
  const list = page.getByRole("list", { name: "Backup codes" });
  await expect(list).toBeVisible();
  const backupCodes = (await list.getByRole("listitem").allTextContents()).map((c) => c.trim());
  await page.getByLabel("I've saved these codes somewhere safe").check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Two-step sign-in is on.")).toBeVisible();
  return { key, backupCodes };
}

/**
 * Admins must have a factor and prove it once per session (enforced in production mode, which
 * e2e runs in): enrol, then pass the "Confirm it's you to open Admin" page.
 */
export async function verifiedAdmin(page: Page, email: string) {
  const { key } = await enrolAuthenticator(page, email);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/app\/settings\/security\/verify/);
  await page.getByLabel("Code from your app").fill(totpFromBase32(key));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return { key };
}

/** Review sheet: Next to the preview, then Upload (the sheet's primary button names the count). */
export async function uploadFromReview(page: Page) {
  const review = page.getByRole("dialog", { name: "Review photos" });
  await review.getByRole("button", { name: "Next" }).click();
  await review.getByRole("button", { name: /^Upload( \d+ receipts)?$/ }).click();
}
