import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/http", () => ({ clientIp: (r: Request) => r.headers.get("x-ip") }));
vi.mock("@/lib/log", () => ({ logger }));

const { POST } = await import("./route");

const report = (
  ip: string,
  body: unknown = {
    "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.example/a?b=c" },
  },
) =>
  POST(
    new Request("https://app.example/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report", "x-ip": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => logger.info.mockClear());

describe("POST /api/csp-report", () => {
  it("logs a redacted summary and answers 204", async () => {
    const res = await report("1.1.1.1");
    expect(res.status).toBe(204);
    expect(logger.info).toHaveBeenCalledWith({
      event: "csp.violation",
      count: 1,
      violations: [{ directive: "img-src", blocked: "x.example" }],
    });
  });

  it("refuses bodies over 16 KB and invalid JSON", async () => {
    expect((await report("2.2.2.2", "x".repeat(17 * 1024))).status).toBe(413);
    expect((await report("2.2.2.2", "{nope")).status).toBe(400);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("rate-limits one client to 30 reports a minute", async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await report("3.3.3.3")).status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);
    expect((await report("4.4.4.4")).status).toBe(204);
  });
});
