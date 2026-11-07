import { beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as Record<string, unknown>[]);
const skipped = vi.hoisted(() => new Set<unknown>());
vi.mock("@/lib/http", () => ({
  clientIp: (r: Request) => r.headers.get("x-ip"),
  skipEvent: (event: unknown) => skipped.add(event),
  withRequestEvent:
    (_spec: unknown, handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown) =>
    (request: Request) => {
      const event = { event: "csp.violation" };
      events.push(event);
      return handler(request, undefined, event);
    },
}));

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

beforeEach(() => {
  events.length = 0;
  skipped.clear();
});

describe("POST /api/csp-report", () => {
  it("logs a redacted summary and answers 204", async () => {
    const res = await report("1.1.1.1");
    expect(res.status).toBe(204);
    expect(events).toEqual([
      {
        event: "csp.violation",
        count: 1,
        violations: [{ directive: "img-src", blocked: "x.example" }],
      },
    ]);
  });

  it("refuses bodies over 16 KB and invalid JSON", async () => {
    expect((await report("2.2.2.2", "x".repeat(17 * 1024))).status).toBe(413);
    expect((await report("2.2.2.2", "{nope")).status).toBe(400);
    expect(events.some((e) => "violations" in e)).toBe(false);
  });

  it("rate-limits one client to 30 reports a minute", async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await report("3.3.3.3")).status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);
    // The rejected report writes no event; the 30 accepted ones each write one.
    expect(events.filter((e) => !skipped.has(e))).toHaveLength(30);
    expect(skipped.size).toBe(1);
    expect((await report("4.4.4.4")).status).toBe(204);
  });
});
