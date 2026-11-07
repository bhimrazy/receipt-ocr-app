import { expect, test } from "@playwright/test";
import { seedReceipts, signIn, signOut, signUp, uniqueEmail } from "./helpers";

test("signed-out visitors are redirected from /app to sign-in", async ({ page }) => {
  await page.goto("/app/history");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("sign up, history, receipt detail, CSV export, sign out and back in", async ({ page }) => {
  const email = uniqueEmail("smoke");
  await signUp(page, email);
  // First run: Home explains the flow instead of showing an empty table.
  await expect(
    page.getByRole("heading", { level: 1, name: "Scan your first receipt" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();

  const merchant = `Corner Store ${Date.now()}`;
  const [receiptId] = await seedReceipts(email, [merchant, "Second Market"]);

  await page.goto("/app/history");
  await expect(page.getByRole("cell", { name: merchant })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Second Market" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^receipts.*\.csv$/);
  const csv = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
  expect(csv).toContain(merchant);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Recent receipts" })).toBeVisible();
  await page.goto("/app/history");
  await page.getByRole("link", { name: merchant }).click();
  await expect(page).toHaveURL(new RegExp(`/app/receipts/${receiptId}`));
  await expect(page.getByRole("heading", { level: 1, name: merchant })).toBeVisible();

  await signOut(page);
  await page.goto("/app/history");
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page, email);
  await page.goto("/app/history");
  await expect(page.getByRole("cell", { name: merchant })).toBeVisible();
});
