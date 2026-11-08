import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { markSteppedUp, PASSWORD, signOut, signUp, uniqueEmail, waitForAuthForm } from "./helpers";

/**
 * Chromium's virtual authenticator (CDP WebAuthn domain): a platform passkey with user
 * verification, answered automatically. BETTER_AUTH_URL is http://localhost:3004 in CI, so the
 * rpID is `localhost`, which WebAuthn allows over http.
 */
async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    credentials: async () =>
      (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials,
    setUserVerified: (isUserVerified: boolean) =>
      cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified }),
  };
}

/** Clears "verified recently" on the user's sessions, so the next important change asks again. */
async function expireStepUp(email: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update session set step_up_at = null
              where user_id = (select id from "user" where email = ${email})`;
  } finally {
    await sql.end();
  }
}

test("add a passkey, confirm a change with it, sign in with it by autofill, then remove it", async ({
  page,
}) => {
  const authenticator = await virtualAuthenticator(page);
  const email = uniqueEmail("passkey");
  await signUp(page, email);

  await markSteppedUp(email);
  await page.goto("/app/settings/security");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await page.getByLabel("Name (optional)").fill("E2E laptop");
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Passkey added.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your passkeys" })).toContainText("E2E laptop");
  expect(await authenticator.credentials()).toHaveLength(1);

  // Not verified recently: changing the password asks, and the passkey answers.
  await expireStepUp(email);
  await page.goto("/app/settings");
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await dialog.getByRole("button", { name: "Use your passkey" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Password changed.")).toBeVisible();

  // Without user verification (no PIN or biometric) the passkey is refused, autofill included.
  await signOut(page);
  await authenticator.setUserVerified(false);
  await page.goto("/sign-in");
  await waitForAuthForm(page);
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.getByText(/didn't work here|Cancelled or timed out/)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);

  // With it, the sign-in page's passkey autofill (conditional UI) signs in by itself; the
  // virtual authenticator answers the pending request without a click.
  await authenticator.setUserVerified(true);
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/app(\/|\?|$)/, { timeout: 15_000 });

  // A passkey sign-in counts as a fresh check, so removing asks nothing more.
  await page.goto("/app/settings/security");
  await page.getByRole("button", { name: "Remove E2E laptop" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove passkey" }).click();
  await expect(page.getByText("Passkey removed.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your passkeys" })).toHaveCount(0);
});
