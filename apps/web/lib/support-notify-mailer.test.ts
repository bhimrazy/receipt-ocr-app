import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  isProduction: false,
  supportEmail: "help@example.com" as string | undefined,
}));
const sendEmail = vi.fn();
vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail,
}));
vi.mock("./mailer", () => ({ mailer: {} }));
vi.mock("./env", () => ({
  emailContext: { appUrl: "https://app.test", supportEmail: "help@example.com" },
  get isProduction() {
    return env.isProduction;
  },
  get supportEmail() {
    return env.supportEmail;
  },
}));

const { SupportNotifyMailer } = await import("@receipt-ocr/core");
const { SupportNotifyMailerLive } = await import("./support-notify-mailer");

const notice = {
  name: "Ada",
  email: "me@example.com",
  kind: "question" as const,
  messageId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  jobId: "job-1",
};
const send = () =>
  Effect.runPromise(
    Effect.flatMap(SupportNotifyMailer, (m) => m.send(notice)).pipe(
      Effect.provide(SupportNotifyMailerLive),
    ),
  );

beforeEach(() => {
  sendEmail.mockReset();
  env.isProduction = false;
  env.supportEmail = "help@example.com";
});

describe("SupportNotifyMailerLive", () => {
  it("mails SUPPORT_EMAIL with the sender as reply-to", async () => {
    sendEmail.mockResolvedValue({ delivered: true });
    expect(await send()).toBe("delivered");
    expect(sendEmail.mock.calls[0][1]).toMatchObject({
      to: "help@example.com",
      replyTo: "me@example.com",
      idempotencyKey: "job:job-1",
    });
    expect(JSON.stringify(sendEmail.mock.calls[0][1])).toContain("/admin/support");
  });

  it("reports a send error as failed, so the job retries", async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: "failed" });
    expect(await send()).toBe("failed");
  });

  it("fails in production without SUPPORT_EMAIL, so the job ends dead and visible", async () => {
    env.isProduction = true;
    env.supportEmail = undefined;
    expect(await send()).toBe("failed");
    env.isProduction = false;
    expect(await send()).toBe("not_configured");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
