import { expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  markSteppedUp,
  PASSWORD,
  seedReceipts,
  signIn,
  signOut,
  signUp,
  uniqueEmail,
} from "./helpers";

/** Turns the account into a Google-only one: no password row, a Google account row instead. */
async function makeProviderOnly(email: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`delete from account where provider_id = 'credential'
              and user_id = (select id from "user" where email = ${email})`;
    await sql`insert into account (id, account_id, provider_id, user_id)
              select ${`e2e-${Date.now()}`}, 'google-e2e', 'google', id from "user" where email = ${email}`;
  } finally {
    await sql.end();
  }
}

test("checklist and sign-in methods, and a first password for a provider-only account", async ({
  page,
}) => {
  const email = uniqueEmail("methods");
  await signUp(page, email);
  await page.goto("/app/settings/security");

  // The e2e build doesn't require a confirmed email, and a password is the only way in.
  await expect(page.getByText("0 of 3 done")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend link" })).toBeVisible();
  const methods = page.getByRole("list", { name: "Ways to sign in" });
  await expect(methods).toContainText("Password set");
  await expect(methods.getByRole("link", { name: "Change password" })).toHaveAttribute(
    "href",
    "/app/settings#password-heading",
  );
  // Passkeys have their own section, with the count beside its heading.
  await expect(page.getByRole("region", { name: "Passkeys" })).toContainText("None");

  await makeProviderOnly(email);
  await page.reload();
  await expect(methods).toContainText("No password yet");
  await markSteppedUp(email);
  await methods.getByRole("button", { name: "Set a password" }).click();
  await methods.getByLabel("New password").fill(PASSWORD);
  await methods.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText("Password set. You can now sign in")).toBeVisible();
  await expect(methods).toContainText("Password set");

  // The new password signs in.
  await signOut(page);
  await signIn(page, email);
});

test("the protect-your-receipts card shows after the fifth receipt and stays dismissed", async ({
  page,
}) => {
  const email = uniqueEmail("prompt");
  await signUp(page, email);
  const card = page.getByRole("complementary", { name: "Protect your receipts" });
  await seedReceipts(email, ["One", "Two", "Three", "Four"]);
  await page.goto("/app");
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(card).toHaveCount(0);

  await seedReceipts(email, ["Five"]);
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Add a passkey" })).toHaveAttribute(
    "href",
    "/app/settings/security#passkeys-heading",
  );
  await card.getByRole("button", { name: "Don't show this again" }).click();
  await expect(card).toHaveCount(0);
  // The cookie is set by a server action; wait for it before reloading.
  await expect
    .poll(async () =>
      (await page.context().cookies()).some((c) => c.name === "receiptocr_security_prompt"),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(card).toHaveCount(0);
});
