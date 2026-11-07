import { beforeEach, describe, expect, it, vi } from "vitest";

const hits = new Map<string, number>();
const hitRateLimit = vi.fn((key: string, _windowMs: number, max: number) => {
  const count = (hits.get(key) ?? 0) + 1;
  hits.set(key, count);
  return { allowed: count <= max, retryAfterSeconds: 60 };
});
const rateLimitReached = vi.fn(
  (key: string, _windowMs: number, max: number) => (hits.get(key) ?? 0) >= max,
);
const runPromise = vi.fn(async (value: unknown) => value);
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/core", () => ({ hitRateLimit, rateLimitReached }));
vi.mock("./runtime", () => ({ runtime: { runPromise } }));
vi.mock("./log", async () => ({
  logger,
  errorFields: (await import("@receipt-ocr/core/telemetry")).errorFields,
}));

const {
  AUTH_EMAILS_PER_HOUR,
  PASSWORD_CHANGES_PER_WINDOW,
  SIGN_IN_FAILURES_PER_WINDOW,
  SIGN_IN_WINDOW_MS,
  allowAuthEmail,
  allowPasswordChange,
  recordSignInFailure,
  signInBlocked,
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

describe("sign-in failure limit", () => {
  it("blocks an address after its failure budget, case-insensitively, for known or unknown alike", async () => {
    expect(await signInBlocked("a@example.com")).toBe(false);
    for (let i = 0; i < SIGN_IN_FAILURES_PER_WINDOW; i++) {
      expect(await signInBlocked("a@example.com")).toBe(false);
      await recordSignInFailure(i % 2 ? " A@Example.com" : "a@example.com");
    }
    expect(await signInBlocked("A@EXAMPLE.COM")).toBe(true);
    expect(await signInBlocked("b@example.com")).toBe(false);
  });

  it("checks without counting, over a 15 minute window, and keys on a hash", async () => {
    await signInBlocked("secret@example.com");
    await signInBlocked("secret@example.com");
    expect(hitRateLimit).not.toHaveBeenCalled();
    await recordSignInFailure("secret@example.com");
    const [key, windowMs] = hitRateLimit.mock.calls[0];
    expect(key).toMatch(/^signin-fail:[0-9a-f]{64}$/);
    expect(windowMs).toBe(SIGN_IN_WINDOW_MS);
    expect(SIGN_IN_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("does not block when the limiter fails", async () => {
    runPromise.mockRejectedValueOnce(new Error("db down"));
    expect(await signInBlocked("a@example.com")).toBe(false);
    runPromise.mockRejectedValueOnce(new Error("db down"));
    await expect(recordSignInFailure("a@example.com")).resolves.toBeUndefined();
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
