import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { sendEmail } = await import("./index");

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
