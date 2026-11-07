import { beforeEach, describe, expect, it, vi } from "vitest";

const hits = new Map<string, number>();
const hitRateLimit = vi.fn((key: string, _windowMs: number, max: number) => {
  const count = (hits.get(key) ?? 0) + 1;
  hits.set(key, count);
  return { allowed: count <= max, retryAfterSeconds: 60 };
});
const runPromise = vi.fn(async (value: unknown) => value);
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/core", () => ({ hitRateLimit }));
vi.mock("./runtime", () => ({ runtime: { runPromise } }));
vi.mock("./log", async () => ({
  logger,
  errorFields: (await import("@receipt-ocr/core/telemetry")).errorFields,
}));

const { AUTH_EMAILS_PER_HOUR, allowAuthEmail } = await import("./email-limits");

beforeEach(() => {
  hits.clear();
  hitRateLimit.mockClear();
  runPromise.mockClear();
});

describe("allowAuthEmail", () => {
  it(`allows ${AUTH_EMAILS_PER_HOUR} emails an hour per address, then refuses`, async () => {
    const results = [];
    for (let i = 0; i <= AUTH_EMAILS_PER_HOUR; i++) {
      results.push(await allowAuthEmail("password-reset", "a@example.com"));
    }
    expect(results).toEqual([...Array(AUTH_EMAILS_PER_HOUR).fill(true), false]);
    expect(hitRateLimit.mock.calls[0][1]).toBe(60 * 60 * 1000);
  });

  it("treats case and padding as the same address, and counts kinds separately", async () => {
    for (let i = 0; i < AUTH_EMAILS_PER_HOUR; i++) {
      await allowAuthEmail("verification", ` User@Example.com`);
    }
    expect(await allowAuthEmail("verification", "user@example.com")).toBe(false);
    expect(await allowAuthEmail("password-reset", "user@example.com")).toBe(true);
  });

  it("keys on a hash, never the address itself", async () => {
    await allowAuthEmail("password-reset", "secret@example.com");
    const key = hitRateLimit.mock.calls[0][0];
    expect(key).not.toContain("secret");
    expect(key).toMatch(/^email:password-reset:[0-9a-f]{64}$/);
  });

  it("lets the email through and logs when the limiter fails", async () => {
    runPromise.mockRejectedValueOnce(new Error("db down for a@example.com"));
    expect(await allowAuthEmail("verification", "a@example.com")).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.email_rate_limit_failed", kind: "verification" }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("example.com");
  });
});
