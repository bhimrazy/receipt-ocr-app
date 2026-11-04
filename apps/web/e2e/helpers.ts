import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export const PASSWORD = "e2e-password-123";

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\//);
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
