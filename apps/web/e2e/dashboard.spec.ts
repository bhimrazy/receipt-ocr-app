import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signUp, uniqueEmail } from "./helpers";

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** Completed receipts in two currencies, one without a date, plus one still processing. */
async function seed(email: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [owner] = await sql<{ user_id: string; organization_id: string }[]>`
      select u.id as user_id, m.organization_id from "user" u join member m on m.user_id = u.id
      where u.email = ${email} limit 1`;
    if (!owner) throw new Error(`no workspace for ${email}`);
    const rows: [string, string | null, string, string, string, string][] = [
      ["Tesco", day(1), "Groceries", "GBP", "42.10", "3.50"],
      ["tesco ", day(3), "Groceries", "GBP", "18.40", "1.20"],
      ["Shell", day(5), "Fuel", "GBP", "61.00", "10.17"],
      ["Pret", day(8), "Meals", "GBP", "9.80", "0.00"],
      ["Pret", day(40), "Meals", "GBP", "12.30", "0.00"],
      ["Lawson", day(2), "Meals", "JPY", "1580.00", "143.00"],
      ["Mystery", null, "Other", "GBP", "5.00", "0.00"],
    ];
    for (const [merchant, date, category, currency, total, tax] of rows) {
      await sql`insert into receipts (organization_id, user_id, merchant, receipt_date, category,
          currency, total, tax, confidence, status, created_at)
        values (${owner.organization_id}, ${owner.user_id}, ${merchant}, ${date}, ${category},
          ${currency}, ${total}, ${tax}, 0.95, 'completed', now() - interval '12 hours')`;
    }
    await sql`insert into receipts (organization_id, user_id, status, file_name)
      values (${owner.organization_id}, ${owner.user_id}, 'processing', 'pending.jpg')`;
  } finally {
    await sql.end();
  }
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Home spending dashboard", () => {
  test("an empty workspace keeps the first-run Home, without a dashboard", async ({ page }) => {
    await signUp(page, uniqueEmail("dash-empty"));
    await expect(page.getByRole("heading", { name: "Scan your first receipt" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spending" })).toHaveCount(0);
  });

  // One seeded account for both widths and the link check: sign-ups are rate-limited per client.
  test("shows per-currency spending at 390 px and on desktop, and links into History", async ({
    page,
  }) => {
    const email = uniqueEmail("dash-data");
    await signUp(page, email);
    await seed(email);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/app");
      const spending = page.getByRole("region", { name: "Spending" });
      await expect(spending).toBeVisible();
      // GBP has more receipts, so it is selected; JPY is offered, never added in.
      const currency = spending.getByRole("navigation", { name: "Currency" });
      await expect(currency.getByRole("link", { name: /GBP/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(
        spending.getByText("1 receipt without a readable date uses its upload date."),
      ).toBeVisible();
      // 42.10 + 18.40 + 61.00 + 9.80 + 5.00 in the last 30 days.
      await expect(spending.getByText("£136.30").first()).toBeVisible();
      await expect(spending.getByRole("heading", { name: "Top merchants" })).toBeVisible();
      await noSidewaysScroll(page);

      await currency.getByRole("link", { name: /JPY/ }).click();
      await expect(page).toHaveURL(/currency=JPY/);
      await expect(spending.getByText("¥1,580").first()).toBeVisible();
      await noSidewaysScroll(page);
    }

    await page.goto("/app?range=3m");
    const categories = page.getByRole("list", { name: "Spend by category" });
    await categories.getByRole("link", { name: /Fuel/ }).click();
    await expect(page).toHaveURL(/\/app\/history\?.*category=Fuel/);
    await expect(page.getByText("Shell").filter({ visible: true }).first()).toBeVisible();
  });

  test("only unread receipts: says spending appears once one is read", async ({ page }) => {
    const email = uniqueEmail("dash-pending");
    await signUp(page, email);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      await sql`insert into receipts (organization_id, user_id, status, file_name)
        select m.organization_id, u.id, 'processing', 'pending.jpg'
        from "user" u join member m on m.user_id = u.id where u.email = ${email}`;
    } finally {
      await sql.end();
    }
    await page.goto("/app");
    await expect(
      page.getByText("Spending shows here once a receipt has been scanned."),
    ).toBeVisible();
  });
});
