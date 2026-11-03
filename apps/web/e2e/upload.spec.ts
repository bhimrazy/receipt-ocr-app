import path from "node:path";
import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// Needs the deterministic fixture OCR provider (OCR_PROVIDER=fixture), which this branch's app
// does not read yet. Set E2E_UPLOAD=1 once it lands; CI sets it then.
test.skip(
  process.env.E2E_UPLOAD !== "1",
  "OCR_PROVIDER=fixture is not supported on this branch yet; set E2E_UPLOAD=1 when it is",
);

test("uploading a receipt image shows the extracted merchant and total", async ({ page }) => {
  await signUp(page, uniqueEmail("upload"));
  await page.goto("/app/upload");
  await page
    .locator('input[type="file"][accept="image/*"]')
    .first()
    .setInputFiles(path.join(import.meta.dirname, "../../../bench/fixtures/npr-lakh.png"));
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Untitled receipt");
});
