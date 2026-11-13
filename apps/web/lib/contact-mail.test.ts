import { describe, expect, it } from "vitest";
import { contactEmail } from "./contact-mail";

const ctx = { appUrl: "https://app.test", supportEmail: "help@example.com" };
const RECEIPT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const base = {
  to: "help@example.com",
  name: "Ada Lovelace",
  from: "me@example.com",
  kind: "feedback" as const,
  message: "Hello there, a question",
  receiptId: null,
};

describe("contactEmail", () => {
  it("goes to the support inbox with the sender as reply-to and a fixed subject", () => {
    const mail = contactEmail(ctx, base);
    expect(mail).toMatchObject({ to: "help@example.com", replyTo: "me@example.com" });
    expect(mail.subject).toBe("[ReceiptOCR support] Feature request");
    expect(mail.text).toContain("From Ada Lovelace (me@example.com)");
  });

  it("escapes HTML in the message", () => {
    expect(contactEmail(ctx, { ...base, message: "<script>alert(1)</script>" }).html).not.toContain(
      "<script>",
    );
  });

  it("links a problem report's receipt", () => {
    const mail = contactEmail(ctx, { ...base, kind: "problem", receiptId: RECEIPT });
    expect(mail.subject).toContain("Problem report");
    expect(mail.text).toContain(`Receipt ${RECEIPT}`);
    expect(mail.text).toContain(`https://app.test/app/receipts/${RECEIPT}`);
  });
});
