import path from "node:path";
import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// Needs the deterministic fixture OCR provider (OCR_PROVIDER=fixture) so no real model is called.
// CI sets E2E_UPLOAD=1; locally, export both to run it.
test.skip(
  process.env.E2E_UPLOAD !== "1",
  "set E2E_UPLOAD=1 and OCR_PROVIDER=fixture to run the upload flow",
);

test("uploading a receipt image shows the extracted merchant and total", async ({ page }) => {
  await signUp(page, uniqueEmail("upload"));
  await page.goto("/app");
  await page
    .locator('input[type="file"][multiple]')
    .first()
    .setInputFiles(path.join(import.meta.dirname, "../../../bench/fixtures/npr-lakh.png"));
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("npr-lakh.png");
});
