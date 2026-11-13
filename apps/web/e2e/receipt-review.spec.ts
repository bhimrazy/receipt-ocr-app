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
    // As migration 0003 flags a receipt the old confidence rule did.
    await sql`update receipts set confidence = 0.6, review_reasons = '{low_confidence}' where id = ${id!}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/app/receipts/${id}`);
  const card = page.getByRole("region", { name: "Check before you use this" });
  await expect(card).toContainText("Overall confidence is 60%");
  // The header badge: Needs review, and the Checked badge that replaces it.
  const flag = page.getByText("Needs review", { exact: true });
  const checked = page.getByText("Checked by E2E User");
  await expect(flag).toBeVisible();
  await expect(checked).toHaveCount(0);

  await card.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText("Reviewed by E2E User")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo review" })).toBeFocused();
  await expect(checked).toBeAttached();
  await expect(flag).toHaveCount(0);

  // Saved: still reviewed after a reload, and out of Needs review.
  await page.reload();
  await expect(page.getByText("Reviewed by E2E User")).toBeVisible();
  await expect(checked).toBeAttached();
  await page.goto("/app/receipts?status=needs-review");
  await expect(page.getByText("Review Test Shop")).toHaveCount(0);

  await page.goto(`/app/receipts/${id}`);
  await page.getByRole("button", { name: "Undo review" }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Looks right" })).toBeFocused();
  await expect(flag).toBeVisible();
  await expect(checked).toHaveCount(0);
  await page.reload();
  await expect(card).toBeVisible();

  // A save the server refuses puts the card back and says why, without offering a pointless retry.
  await page.route(`**/api/receipts/${id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 404, json: { error: "Receipt not found" } })
      : route.continue(),
  );
  await card.getByRole("button", { name: "Looks right" }).click();
  await expect(
    page.getByText("This receipt was deleted, or you can no longer change it"),
  ).toBeVisible();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Looks right" })).toBeFocused();
  await expect(page.getByText("Reviewed by E2E User")).toHaveCount(0);
  await expect(flag).toBeVisible();
});
