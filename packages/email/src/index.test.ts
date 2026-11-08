import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const create = vi.fn();
const update = vi.fn();
const add = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    contacts = { create, update, segments: { add } };
  },
}));

const { sendEmail, subscribeContact, unsubscribeContact } = await import("./index");

afterEach(() => vi.restoreAllMocks());

describe("sendEmail logging", () => {
  const input = {
    to: "Person@Example.com",
    subject: "Ada Lovelace invited you to Dr Smith Clinic",
    html: "<p>h</p>",
    text: "https://app.test/accept-invitation/secret-id",
  };
  const config = { apiKey: "key", from: "x <noreply@example.com>" };

  it("never logs the address, its domain, the subject, the body or an error message", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
    send.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field: Person@Example.com" },
    });
    send.mockRejectedValueOnce(new TypeError("connect ECONNREFUSED for Person@Example.com"));
    await sendEmail(config, input);
    await sendEmail(config, input);
    await sendEmail(config, input);
    await sendEmail({}, input);
    const lines = [...info.mock.calls, ...error.mock.calls].map(([line]) => String(line));
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain("example.com");
      expect(line).not.toContain("Lovelace");
      expect(line).not.toContain("Smith");
      expect(line).not.toContain("secret-id");
    }
    expect(lines.map((line) => [JSON.parse(line).event, JSON.parse(line).error ?? null])).toEqual([
      ["email.sent", null],
      ["email.send_failed", { type: "ResendError", kind: "validation_error" }],
      ["email.send_failed", { type: "TypeError" }],
      ["email.not_configured", null],
    ]);
  });

  it("hands events to the configured sink instead of the console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.fn();
    send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
    await sendEmail({ ...config, log }, input);
    expect(log).toHaveBeenCalledWith({ event: "email.sent", unit: "log", level: "info" });
    expect(info).not.toHaveBeenCalled();
  });
});

describe("sendEmail reply-to", () => {
  const input = { to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t" };
  const config = { apiKey: "key", from: "x <noreply@example.com>" };
  const sentWith = async (cfg: object, msg: object) => {
    send.mockClear();
    send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
    await sendEmail({ ...config, ...cfg, log: () => {} }, { ...input, ...msg });
    return send.mock.calls[0][0];
  };

  it("defaults to the configured reply-to", async () => {
    expect(await sentWith({ replyTo: "support@example.com" }, {})).toMatchObject({
      replyTo: "support@example.com",
    });
  });

  it("lets a per-message reply-to win, as the contact form does", async () => {
    expect(
      await sentWith({ replyTo: "support@example.com" }, { replyTo: "visitor@example.com" }),
    ).toMatchObject({ replyTo: "visitor@example.com" });
  });

  it("sets no Reply-To without either", async () => {
    expect(await sentWith({}, {})).not.toHaveProperty("replyTo");
  });
});

describe("newsletter contacts", () => {
  const config = { apiKey: "key", segmentId: "seg", log: vi.fn() };
  afterEach(() => {
    create.mockReset();
    update.mockReset();
    add.mockReset();
  });

  it("does nothing without a key and a segment", async () => {
    expect(await subscribeContact({ apiKey: "key" }, "a@b.co")).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(await unsubscribeContact({ segmentId: "seg" }, "a@b.co")).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a subscribed contact in the segment", async () => {
    create.mockResolvedValue({ data: { id: "1" }, error: null });
    expect(await subscribeContact(config, "a@b.co")).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      email: "a@b.co",
      unsubscribed: false,
      segments: [{ id: "seg" }],
    });
  });

  it("re-subscribes a contact that already exists", async () => {
    create.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 409 } });
    update.mockResolvedValue({ data: {}, error: null });
    add.mockResolvedValue({ data: {}, error: null });
    expect(await subscribeContact(config, "a@b.co")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ email: "a@b.co", unsubscribed: false });
    expect(add).toHaveBeenCalledWith({ email: "a@b.co", segmentId: "seg" });
  });

  it("reports a failure without throwing or logging the address", async () => {
    create.mockRejectedValue(new Error("boom for a@b.co"));
    const log = vi.fn();
    expect(await subscribeContact({ ...config, log }, "a@b.co")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("b.co");
    expect(log.mock.calls[0]?.[0]).toMatchObject({ event: "email.contact_failed" });
  });

  it("unsubscribes by address and treats a missing contact as done", async () => {
    update.mockResolvedValueOnce({ data: {}, error: null });
    expect(await unsubscribeContact(config, "a@b.co")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ email: "a@b.co", unsubscribed: true });
    update.mockResolvedValueOnce({ data: null, error: { name: "not_found", statusCode: 404 } });
    expect(await unsubscribeContact(config, "a@b.co")).toEqual({ ok: true });
    update.mockResolvedValueOnce({ data: null, error: { name: "x", statusCode: 500 } });
    expect(await unsubscribeContact(config, "a@b.co")).toEqual({ ok: false, reason: "failed" });
  });
});
