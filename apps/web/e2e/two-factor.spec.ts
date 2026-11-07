import { expect, test } from "@playwright/test";
import {
  enrolAuthenticator,
  PASSWORD,
  signOut,
  signUp,
  totpCode,
  uniqueEmail,
  waitForAuthForm,
} from "./helpers";

async function passwordStep(page: import("@playwright/test").Page, email: string) {
  await page.goto("/sign-in");
  await waitForAuthForm(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in\/two-factor/);
  await waitForAuthForm(page);
}

test("turn on two-step sign-in, then sign in with a code and with a backup code", async ({
  page,
}) => {
  const email = uniqueEmail("totp");
  await signUp(page, email);
  const { key, backupCodes } = await enrolAuthenticator(page, email);
  expect(backupCodes).toHaveLength(10);
  await signOut(page);

  // The code page refuses a wrong code in plain words, then accepts the app's code.
  await passwordStep(page, email);
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't right");
  await page.getByLabel("Authentication code").fill(totpCode(key));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/app(\/|\?|$)/);
  await signOut(page);

  await passwordStep(page, email);
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code").fill(backupCodes[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/app(\/|\?|$)/);
});

test("new backup codes need a fresh 'confirm it's you' check", async ({ page }) => {
  const email = uniqueEmail("stepup");
  await signUp(page, email);
  const { key } = await enrolAuthenticator(page, email);

  await page.getByRole("button", { name: "New backup codes" }).click();
  await page.getByLabel(/Confirm your password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Make new codes" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Code from your app").fill(totpCode(key));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "Backup codes" }).getByRole("listitem")).toHaveCount(
    10,
  );
});

test("the code page sends you back to sign in without a password step", async ({ page }) => {
  await page.goto("/sign-in/two-factor");
  await expect(page).toHaveURL(/\/sign-in$/);
});
