import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

test.skip(
  process.env.E2E_UPLOAD !== "1",
  "set E2E_UPLOAD=1 and OCR_PROVIDER=fixture to run the upload flow",
);

test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 255);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
});

/** A plain PDF with `pages` page objects. */
function pdf(pages: number) {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj`,
    ...Array.from(
      { length: pages },
      (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>\nendobj`,
    ),
  ];
  return Buffer.from(`%PDF-1.4\n${objects.join("\n")}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

test("a PDF over 10 pages is refused with a clear message", async ({ page }) => {
  await signUp(page, uniqueEmail("pdfpages"));
  await page.goto("/app");
  const input = page.locator('input[type="file"][multiple]').first();
  await input.setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: pdf(11),
  });
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(page.getByText(/PDFs can have up to 10 pages/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});
