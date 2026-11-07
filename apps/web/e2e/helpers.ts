import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export const PASSWORD = "e2e-password-123";

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/**
 * Fills a credentials form and submits it. The inputs are controlled React fields: text typed
 * before the page hydrates is wiped when React takes over, and the browser's `required` check then
 * blocks the submit silently, leaving the page on /sign-up. So wait for the network to settle,
 * and if the click went nowhere, fill again and retry (a swallowed click sent nothing).
 */
async function submitCredentials(
  page: Page,
  fields: Array<[string, string, boolean]>,
  button: string,
) {
  await page.waitForLoadState("networkidle");
  const url = page.url();
  await expect(async () => {
    for (const [label, value, exact] of fields) {
      await page.getByLabel(label, { exact }).fill(value);
    }
    await page.getByRole("button", { name: button }).click();
    await expect.poll(() => page.url(), { timeout: 4_000 }).not.toBe(url);
  }).toPass({ timeout: 25_000 });
}

export async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await submitCredentials(
    page,
    [
      ["Name", "E2E User", false],
      ["Email", email, false],
      ["Password", PASSWORD, true],
    ],
    "Create account",
  );
  await expect(page).toHaveURL(/\/app(\/|\?|$)/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await submitCredentials(
    page,
    [
      ["Email", email, false],
      ["Password", PASSWORD, true],
    ],
    "Sign in",
  );
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
