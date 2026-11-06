import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const env = vi.hoisted(() => ({
  isProduction: false,
  supportEmail: "help@example.com" as string | undefined,
}));

vi.mock("@receipt-ocr/email", () => ({ sendEmail }));
vi.mock("@receipt-ocr/core", () => ({ hitRateLimit: () => ({}) }));
vi.mock("@/lib/runtime", () => ({
  runtime: { runPromise: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
}));
vi.mock("@/lib/http", () => ({ clientIp: () => "1.1.1.1", crossOriginResponse: () => null }));
vi.mock("@/lib/log", () => ({ logger: { info: vi.fn() } }));
vi.mock("@/lib/env", () => ({
  emailEnv: { resendApiKey: "key", from: "x <noreply@example.com>" },
  get isProduction() {
    return env.isProduction;
  },
  get supportEmail() {
    return env.supportEmail;
  },
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/contact", { method: "POST", body: JSON.stringify(body) }));
const valid = { email: "me@example.com", message: "Hello there, a question", topic: "feature" };

beforeEach(() => {
  sendEmail.mockReset();
  env.isProduction = false;
  env.supportEmail = "help@example.com";
});

describe("POST /api/contact", () => {
  it("sends to the support inbox with the sender as reply-to", async () => {
    sendEmail.mockResolvedValue({ delivered: true });
    const res = await post(valid);
    expect(res.status).toBe(200);
    const input = sendEmail.mock.calls[0][1];
    expect(input).toMatchObject({ to: "help@example.com", replyTo: "me@example.com" });
    expect(input.subject).toBe("[receiptOCR support] Feature request");
  });

  it("escapes HTML in the message", async () => {
    sendEmail.mockResolvedValue({ delivered: true });
    await post({ ...valid, message: "<script>alert(1)</script>" });
    expect(sendEmail.mock.calls[0][1].html).not.toContain("<script>");
  });

  it("returns an error in production when delivery fails", async () => {
    env.isProduction = true;
    sendEmail.mockResolvedValue({ delivered: false, reason: "failed" });
    const res = await post(valid);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/couldn't send/);
  });

  it("returns an error in production when SUPPORT_EMAIL is unset", async () => {
    env.isProduction = true;
    env.supportEmail = undefined;
    const res = await post(valid);
    expect(res.status).toBe(503);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("simulates success outside production when no mailer delivers", async () => {
    sendEmail.mockResolvedValue({ delivered: false, reason: "not_configured" });
    expect((await post(valid)).status).toBe(200);
  });

  it("rejects an invalid email and sends nothing", async () => {
    const res = await post({ ...valid, email: "nope" });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("drops honeypot submissions without sending", async () => {
    const res = await post({ ...valid, company: "Acme" });
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
