import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

test("marking a receipt reviewed replaces its checks with who reviewed it, and Undo brings them back", async ({
  page,
}) => {
  const email = uniqueEmail("review");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Review Test Shop"]);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update receipts set confidence = 0.6 where id = ${id!}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/app/receipts/${id}`);
  const card = page.getByRole("region", { name: "Check before you use this" });
  await expect(card).toContainText("Overall confidence is 60%");

  await card.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText("Reviewed by E2E User")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo review" })).toBeFocused();

  // Saved: still reviewed after a reload, and out of Needs review.
  await page.reload();
  await expect(page.getByText("Reviewed by E2E User")).toBeVisible();
  await page.goto("/app/history?status=needs-review");
  await expect(page.getByText("Review Test Shop")).toHaveCount(0);

  await page.goto(`/app/receipts/${id}`);
  await page.getByRole("button", { name: "Undo review" }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Looks right" })).toBeFocused();
  await page.reload();
  await expect(card).toBeVisible();
});
