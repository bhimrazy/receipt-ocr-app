import { expect, test } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

test("API hardening: workspace names, receipt ids and Origin checks", async ({ page, baseURL }) => {
  const email = uniqueEmail("sec");
  await signUp(page, email);
  const [receiptId] = await seedReceipts(email, ["Origin Check Mart"]);
  const origin = { origin: new URL(baseURL!).origin };

  // Markup or an over-long name never reaches the workspace (or invitation mail).
  const session = await (await page.request.get("/api/auth/get-session")).json();
  const organizationId = session.session.activeOrganizationId as string;
  for (const name of ['Acme</strong><h1 style="color:red">locked</h1>', "x".repeat(81)]) {
    const res = await page.request.post("/api/auth/organization/update", {
      headers: origin,
      data: { organizationId, data: { name } },
    });
    expect(res.status(), name.slice(0, 20)).toBe(400);
  }

  // L3: a malformed id is a 404, not a 500.
  expect((await page.request.get("/api/receipts/not-a-uuid")).status()).toBe(404);

  // L4: a mutation without Origin is refused; with the app's Origin it goes through.
  const bare = await page.request.delete(`/api/receipts/${receiptId}`);
  expect(bare.status()).toBe(403);
  const ok = await page.request.delete(`/api/receipts/${receiptId}`, { headers: origin });
  expect(ok.status()).toBe(200);
});
