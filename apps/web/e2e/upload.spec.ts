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

test("a phone-sized photo is shrunk in the browser, then uploads", async ({ page }) => {
  await signUp(page, uniqueEmail("bigphoto"));
  await page.goto("/app");
  // Noise defeats JPEG compression, so this stands in for a 12 MP sensor photo well over the 4.5 MB body limit.
  const original = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3024;
    canvas.height = 4032;
    const ctx = canvas.getContext("2d")!;
    const px = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < px.data.length; i += 4) {
      const v = 128 + Math.floor(Math.random() * 90 - 45);
      px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
      px.data[i + 3] = 255;
    }
    ctx.putImageData(px, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.6),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  expect(original.length).toBeGreaterThan(4_500_000);
  await page
    .locator('input[type="file"][multiple]')
    .first()
    .setInputFiles({
      name: "phone-photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(original),
    });
  // Prepared in the browser: the queued file is far smaller than what was picked.
  const size = page.getByRole("list", { name: "Receipts to read" }).getByText(/\d KB|\d\.\d MB/);
  await expect(size).toBeVisible();
  await expect(size).not.toHaveText(/MB/);
  const requests: number[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/receipts") && r.method() === "POST") {
      requests.push(r.postDataBuffer()?.length ?? 0);
    }
  });
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
  expect(requests[0]).toBeLessThan(4_400_000);
});

test("a PDF is accepted, and one over the body limit is refused before upload", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("pdf"));
  await page.goto("/app");
  const input = page.locator('input[type="file"][multiple]').first();
  await expect(input).toHaveAttribute("accept", /application\/pdf/);

  const tooBig = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5_000_000, 0x20)]);
  await input.setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: tooBig });
  await expect(page.getByText(/huge\.pdf is 4\.8 MB/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Read receipt" })).toHaveCount(0);

  await input.setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(page).toHaveURL(/\/app\/receipts\//, { timeout: 30_000 });
});
