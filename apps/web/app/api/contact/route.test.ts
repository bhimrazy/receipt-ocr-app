import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const env = vi.hoisted(() => ({
  isProduction: false,
  supportEmail: "help@example.com" as string | undefined,
  turnstile: { ok: true } as
    { ok: true } | { ok: false; reason: "missing" | "rejected" | "unavailable" },
}));

vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail,
}));
vi.mock("@receipt-ocr/core", () => ({ hitRateLimit: () => ({}) }));
vi.mock("@/lib/runtime", () => ({
  runtime: { runPromise: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
}));
const specs = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/http", () => ({
  clientIp: () => "1.1.1.1",
  crossOriginResponse: () => null,
  withRequestEvent: (
    spec: unknown,
    handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown,
  ) => {
    specs.push(spec);
    return (request: Request, context?: unknown) => handler(request, context, { event: "test" });
  },
}));
vi.mock("@/lib/turnstile", () => ({ checkTurnstile: async () => env.turnstile }));
vi.mock("@/lib/log", () => ({ logger: { info: vi.fn() } }));
vi.mock("@/lib/env", () => ({
  emailEnv: { resendApiKey: "key", from: "x <noreply@example.com>", replyTo: "help@example.com" },
  emailContext: { appUrl: "https://app.test", supportEmail: "help@example.com" },
  logUndeliveredMail: () => false,
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
  env.turnstile = { ok: true };
});

describe("POST /api/contact", () => {
  it.each([
    ["missing", 400],
    ["rejected", 403],
    ["unavailable", 503],
  ] as const)("sends nothing when the Turnstile check is %s", async (reason, status) => {
    env.turnstile = { ok: false, reason };
    const res = await post(valid);
    expect(res.status).toBe(status);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps every rate-limited submission in the logs (abuse signal, never sampled)", () => {
    expect(specs).toEqual([expect.objectContaining({ keepRateLimited: true })]);
  });

  it("sends to the support inbox with the sender as reply-to", async () => {
    sendEmail.mockResolvedValue({ delivered: true });
    const res = await post(valid);
    expect(res.status).toBe(200);
    const input = sendEmail.mock.calls[0][1];
    expect(input).toMatchObject({ to: "help@example.com", replyTo: "me@example.com" });
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ replyTo: "help@example.com" });
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
