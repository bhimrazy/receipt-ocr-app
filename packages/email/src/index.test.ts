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
  const input = { to: "Person@Example.com", subject: "s", html: "<p>h</p>", text: "t" };
  const config = { apiKey: "key", from: "x <noreply@example.com>" };

  it("logs the recipient domain, never the address, on success and failure", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
    send.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    send.mockRejectedValueOnce(new Error("down"));
    await sendEmail(config, input);
    await sendEmail(config, input);
    await sendEmail(config, input);
    const lines = [...info.mock.calls, ...error.mock.calls].map(([line]) => String(line));
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).not.toContain("Person@");
      expect(JSON.parse(line).to_domain).toBe("example.com");
    }
  });
});
