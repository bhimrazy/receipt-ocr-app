import { expect, test } from "@playwright/test";
import { ageSessions, PASSWORD, signUp, uniqueEmail } from "./helpers";

async function changePassword(page: import("@playwright/test").Page, from: string, to: string) {
  await page.getByLabel("Current password").fill(from);
  await page.getByLabel("New password").fill(to);
  await page.getByRole("button", { name: "Change password" }).click();
}

test("without a second factor, a recent sign-in confirms a password change, and signing in again renews it", async ({
  page,
}) => {
  const email = uniqueEmail("signin-stepup");
  await signUp(page, email);
  await page.goto("/app/settings");

  // Just signed up: no dialog.
  await changePassword(page, PASSWORD, `${PASSWORD}-2`);
  await expect(page.getByText("Password changed.")).toBeVisible();

  // An hour later, the same change asks to confirm; signing in again in the dialog finishes it.
  await ageSessions(email);
  await page.reload();
  await changePassword(page, `${PASSWORD}-2`, `${PASSWORD}-3`);
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Email me a code instead" })).toBeVisible();
  await dialog.getByLabel(`Password for ${email}`).fill("not-the-password");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("That password is not correct.")).toBeVisible();
  await dialog.getByLabel(`Password for ${email}`).fill(`${PASSWORD}-2`);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Password changed.")).toBeVisible();
});
