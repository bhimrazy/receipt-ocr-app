import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// Runs in the `chromium` (fine pointer) project: the camera is for touch devices only, even
// when a webcam exists.
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("desktop offers no camera button and ?capture=1 just shows the upload page", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("desktop-nocam"));
  await page.goto("/app/upload?capture=1");
  await expect(page.getByRole("heading", { name: "Upload receipts" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/upload$/);
  await expect(page.locator("[data-ready]")).toBeAttached();
  await expect(page.getByRole("button", { name: "Take photos" })).toBeHidden();
  await expect(page.getByText("Take photos or choose files")).toBeHidden();
  await expect(page.getByText(/Drop receipt photos or PDFs here/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Camera" })).toHaveCount(0);
});
