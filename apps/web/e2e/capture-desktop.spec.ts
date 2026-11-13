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
  await expect(page.getByRole("heading", { name: "Add receipts" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/upload$/);
  await expect(page.locator("[data-ready]")).toBeAttached();
  await expect(page.getByRole("button", { name: "Take photos" })).toBeHidden();
  await expect(page.getByText("Take photos or choose files")).toBeHidden();
  await expect(page.getByText(/Drop receipt photos or PDFs here/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Camera" })).toHaveCount(0);
});

test("the sidebar's Add receipts button opens the upload page and is the only current link there", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("desktop-add"));
  await page.goto("/app");
  const sidebar = page.getByRole("navigation", { name: "Main" });
  const add = page.getByRole("link", { name: "Add receipts" });
  await expect(add).toHaveAttribute("href", "/app/upload");
  await expect(add).not.toHaveAttribute("aria-current");

  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/upload$/);
  await expect(page).toHaveTitle(/Add receipts/);
  await expect(add).toHaveAttribute("aria-current", "page");
  await expect(sidebar.locator("[aria-current]")).toHaveCount(0);
});
