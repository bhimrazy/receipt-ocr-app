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

test("saving a correction marks the receipt checked and clears its line warnings, and Undo brings them back", async ({
  page,
}) => {
  const email = uniqueEmail("review-save");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Edit Review Shop"]);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update receipts set review_reasons = '{no_date}', receipt_date = null where id = ${id!}`;
    await sql`update receipt_items set confidence = 0.5 where receipt_id = ${id!}`;
  } finally {
    await sql.end();
  }
  const card = page.getByRole("region", { name: "Check before you use this" });
  const lineWarning = page.getByText("Check this line against the photo");
  const lineNote = page.getByText("Marked lines were hard to read.");

  await page.goto("/app/receipts?status=needs-review");
  await expect(page.getByText("Edit Review Shop").filter({ visible: true }).first()).toBeVisible();
  await page.goto(`/app/receipts/${id}`);
  await expect(card).toContainText("No date was found.");
  await expect(lineWarning).toBeVisible();
  await expect(lineNote).toBeVisible();

  // The correction leaves the date empty: saving still vouches for the receipt.
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Merchant", { exact: true }).fill("Edit Review Shop Ltd");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Reviewed by E2E User")).toBeVisible();
  await expect(card).toBeHidden();
  await expect(lineWarning).toHaveCount(0);
  await expect(lineNote).toHaveCount(0);

  await page.goto("/app/receipts?status=needs-review");
  await expect(page.getByText("Edit Review Shop Ltd")).toHaveCount(0);

  await page.goto(`/app/receipts/${id}`);
  await page.getByRole("button", { name: "Undo review" }).click();
  await expect(card).toContainText("No date was found.");
  await expect(lineWarning).toBeVisible();
});

test("the Details card leaves out optional fields the receipt doesn't have", async ({ page }) => {
  const email = uniqueEmail("details-empty");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Sparse Shop"]);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update receipts set subtotal = null, tax = null where id = ${id!}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/app/receipts/${id}`);
  const details = page.locator("dl").first();
  for (const label of ["Merchant", "Date", "Category", "Currency"])
    await expect(details.getByText(label, { exact: true })).toBeVisible();
  for (const label of ["Subtotal", "Tax", "Tip", "Discount", "Service charge", "Bill number"])
    await expect(details.getByText(label, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Total", { exact: true })).toBeVisible();

  // The editor still offers every field.
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Tip", { exact: true }).fill("2.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(details.getByText("Tip", { exact: true })).toBeVisible();
});
