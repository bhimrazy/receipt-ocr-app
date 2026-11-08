import { expect, test } from "@playwright/test";
import { markSteppedUp, PASSWORD, signUp, uniqueEmail } from "./helpers";

async function changePassword(page: import("@playwright/test").Page, from: string, to: string) {
  await page.getByLabel("Current password").fill(from);
  await page.getByLabel("New password").fill(to);
  await page.getByRole("button", { name: "Change password" }).click();
}

test("without a second factor, a password change right after sign-up asks for the emailed code", async ({
  page,
}) => {
  const email = uniqueEmail("email-stepup");
  await signUp(page, email);
  await page.goto("/app/settings");

  // Just signed up, yet the change still asks; the only way offered is the emailed code.
  await changePassword(page, PASSWORD, `${PASSWORD}-2`);
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`We'll email a 6-digit code to ${email}.`)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Email me a code" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /sign in again/i })).toHaveCount(0);
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Password changed.")).toHaveCount(0);

  // The e2e build has no mailer; with the check recorded as passed, the change goes through.
  await markSteppedUp(email);
  await changePassword(page, PASSWORD, `${PASSWORD}-2`);
  await expect(page.getByText("Password changed.")).toBeVisible();
});
