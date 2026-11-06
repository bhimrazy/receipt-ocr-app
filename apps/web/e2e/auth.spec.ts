import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { PASSWORD, signIn, signUp, uniqueEmail } from "./helpers";

test("sign-in explains a wrong password in plain words", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("don't match an account");
});

test("sign-up shows the password rule before submitting and can reveal the password", async ({
  page,
}) => {
  await page.goto("/sign-up");
  const password = page.getByLabel("Password", { exact: true });
  await expect(page.getByText("At least 8 characters")).toBeVisible();
  await password.fill("long-enough");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
});

test("sign-up with a taken email points to sign in", async ({ page, browser }) => {
  const email = uniqueEmail("taken");
  await signUp(page, email);

  const fresh = await browser.newPage();
  await fresh.goto("/sign-up");
  await fresh.getByLabel("Name").fill("Second Person");
  await fresh.getByLabel("Email").fill(email);
  await fresh.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await fresh.getByRole("button", { name: "Create account" }).click();
  await expect(fresh.getByRole("main").getByRole("alert")).toContainText("already exists");
  await fresh.getByRole("link", { name: "Sign in instead" }).click();
  await expect(fresh).toHaveURL(/\/sign-in/);
  await fresh.close();
});

test("forgot password confirms without revealing whether the account exists", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(uniqueEmail("forgot"));
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
});

test("a reset link without a token says it can't be used", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This reset link can't be used" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

test("an invited person signs up, confirms their email and joins the workspace", async ({
  page,
  browser,
  baseURL,
}) => {
  await signUp(page, uniqueEmail("owner"));
  const invitee = uniqueEmail("invitee");
  const orgs = (await (await page.request.get("/api/auth/organization/list")).json()) as {
    id: string;
  }[];
  const res = await page.request.post("/api/auth/organization/invite-member", {
    data: { email: invitee, role: "member", organizationId: orgs[0]!.id },
    headers: { origin: baseURL! },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = (await res.json()) as { id: string };

  const guest = await browser.newPage();
  await guest.goto(`/accept-invitation/${id}`);
  await expect(guest).toHaveURL(/\/sign-in\?redirect=/);
  await expect(guest.getByRole("main").getByRole("status")).toContainText("accept your invitation");
  await guest.getByRole("link", { name: "Create an account" }).click();
  await guest.getByLabel("Name").fill("Invited Person");
  await guest.getByLabel("Email").fill(invitee);
  await guest.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await guest.getByRole("button", { name: "Create account" }).click();

  // Better Auth only lets a confirmed address answer an invitation.
  await expect(guest).toHaveURL(new RegExp(`/accept-invitation/${id}`));
  await expect(guest.getByRole("heading", { name: "Confirm your email first" })).toBeVisible();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update "user" set email_verified = true where email = ${invitee}`;
  } finally {
    await sql.end();
  }
  // A new session picks up the confirmed address (the session cookie caches the user).
  await guest.context().clearCookies();
  await signIn(guest, invitee);

  await guest.goto(`/accept-invitation/${id}`);
  await expect(guest.getByText(invitee)).toBeVisible();
  await guest.getByRole("button", { name: /^Join / }).click();
  await expect(guest).toHaveURL(/\/app(\/|\?|$)/);
  await guest.close();
});
