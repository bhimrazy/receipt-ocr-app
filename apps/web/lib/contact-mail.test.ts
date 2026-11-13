import { describe, expect, it } from "vitest";
import { contactEmail } from "./contact-mail";

const ctx = { appUrl: "https://app.test", supportEmail: "help@example.com" };
const base = {
  to: "help@example.com",
  name: "Ada Lovelace",
  from: "me@example.com",
  kind: "feedback" as const,
  messageId: "0f8fad5b-d9cb-469f-a165-70867728950e",
};

describe("contactEmail", () => {
  it("goes to the support inbox with the sender as reply-to and a fixed subject", () => {
    const mail = contactEmail(ctx, base);
    expect(mail).toMatchObject({ to: "help@example.com", replyTo: "me@example.com" });
    expect(mail.subject).toBe("[ReceiptOCR support] Feature request");
    expect(mail.text).toContain("Message 0f8fad5b from Ada Lovelace");
  });

  it("links to the admin list on the app's own origin", () => {
    const mail = contactEmail(ctx, { ...base, kind: "problem" });
    expect(mail.subject).toContain("Problem report");
    expect(mail.text).toContain("https://app.test/admin/support");
    expect(mail.html).toContain('href="https://app.test/admin/support"');
  });
});
