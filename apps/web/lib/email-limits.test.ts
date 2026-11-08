import { beforeEach, describe, expect, it, vi } from "vitest";

const hits = new Map<string, number>();
const hitRateLimit = vi.fn((key: string, _windowMs: number, max: number) => {
  const count = (hits.get(key) ?? 0) + 1;
  hits.set(key, count);
  return { allowed: count <= max, retryAfterSeconds: 60 };
});
const clearRateLimit = vi.fn((key: string) => {
  hits.delete(key);
});
const runPromise = vi.fn(async (value: unknown) => value);
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/core", () => ({ hitRateLimit, clearRateLimit }));
vi.mock("./runtime", () => ({ runtime: { runPromise } }));
vi.mock("./log", async () => ({
  logger,
  errorFields: (await import("@receipt-ocr/core/telemetry")).errorFields,
}));

const {
  AUTH_EMAILS_PER_HOUR,
  PASSWORD_CHANGES_PER_WINDOW,
  SIGN_IN_ATTEMPTS_PER_WINDOW,
  allowAuthEmail,
  allowPasswordChange,
  allowSignInAttempt,
  clearSignInAttempts,
} = await import("./email-limits");

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

describe("sign-in attempt limit", () => {
  it("allows 10 attempts per address, case-insensitively, then blocks; other addresses are unaffected", async () => {
    const results = [];
    for (let i = 0; i < SIGN_IN_ATTEMPTS_PER_WINDOW + 2; i++) {
      results.push(await allowSignInAttempt(i % 2 ? " A@Example.com" : "a@example.com"));
    }
    expect(results).toEqual([...Array(SIGN_IN_ATTEMPTS_PER_WINDOW).fill(true), false, false]);
    expect(await allowSignInAttempt("b@example.com")).toBe(true);
  });

  it("keys on a hash over a 15 minute window", async () => {
    await allowSignInAttempt("secret@example.com");
    const [key, windowMs] = hitRateLimit.mock.calls[0];
    expect(key).toMatch(/^signin-fail:[0-9a-f]{64}$/);
    expect(key).not.toContain("secret");
    expect(windowMs).toBe(15 * 60 * 1000);
  });

  it("clearing after a correct sign-in resets the count", async () => {
    for (let i = 0; i < SIGN_IN_ATTEMPTS_PER_WINDOW + 1; i++)
      await allowSignInAttempt("a@example.com");
    expect(await allowSignInAttempt("a@example.com")).toBe(false);
    await clearSignInAttempts(" A@example.com");
    expect(await allowSignInAttempt("a@example.com")).toBe(true);
  });

  it("lets the attempt through when the limiter fails", async () => {
    runPromise.mockRejectedValueOnce(new Error("db down"));
    expect(await allowSignInAttempt("a@example.com")).toBe(true);
    runPromise.mockRejectedValueOnce(new Error("db down"));
    await expect(clearSignInAttempts("a@example.com")).resolves.toBeUndefined();
  });
});

describe("allowPasswordChange", () => {
  it("caps attempts per user", async () => {
    for (let i = 0; i < PASSWORD_CHANGES_PER_WINDOW; i++) {
      expect(await allowPasswordChange("u1")).toBe(true);
    }
    expect(await allowPasswordChange("u1")).toBe(false);
    expect(await allowPasswordChange("u2")).toBe(true);
  });
});
