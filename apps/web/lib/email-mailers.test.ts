import { ContactReplyMailer, WelcomeMailer } from "@receipt-ocr/core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ emailContext: {} }));
vi.mock("./mailer", () => ({ mailer: { apiKey: "key" } }));
vi.mock("./plan-copy", () => ({ welcomePlanLine: () => "plan line" }));

const sendEmail = vi.fn();
const content = { subject: "s", html: "<p>h</p>", text: "t" };
vi.mock("@receipt-ocr/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  welcomeEmail: () => content,
  contactReplyEmail: () => content,
}));

const { WelcomeMailerLive } = await import("./welcome-mailer");
const { ContactReplyMailerLive } = await import("./contact-reply-mailer");

const welcome = () =>
  Effect.runPromise(
    Effect.flatMap(WelcomeMailer, (m) =>
      m.send({ to: "a@example.com", plan: "free", policy: {}, idempotencyKey: "job:w1" } as never),
    ).pipe(Effect.provide(WelcomeMailerLive)),
  );
const reply = () =>
  Effect.runPromise(
    Effect.flatMap(ContactReplyMailer, (m) =>
      m.send({ to: "a@example.com", name: "Ada", topic: "other", idempotencyKey: "job:c1" }),
    ).pipe(Effect.provide(ContactReplyMailerLive)),
  );

describe.each([
  ["welcome", welcome, "job:w1"],
  ["contact reply", reply, "job:c1"],
] as const)("%s mailer", (_name, send, key) => {
  beforeEach(() => sendEmail.mockReset());

  it("forwards the job's idempotency key to sendEmail", async () => {
    sendEmail.mockResolvedValue({ delivered: true });
    expect(await send()).toBe("delivered");
    expect(sendEmail.mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: key });
  });

  it("maps a changed-payload idempotency conflict to conflict", async () => {
    sendEmail.mockResolvedValue({
      delivered: false,
      reason: "failed",
      errorName: "invalid_idempotent_request",
    });
    expect(await send()).toBe("conflict");
  });

  it("keeps a concurrent idempotent request retryable", async () => {
    sendEmail.mockResolvedValue({
      delivered: false,
      reason: "failed",
      errorName: "concurrent_idempotent_requests",
    });
    expect(await send()).toBe("failed");
  });
});
