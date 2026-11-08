import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const enqueue = vi.fn();
vi.mock("@receipt-ocr/core", () => ({ enqueueWelcomeEmail: (id: string) => enqueue(id) }));
const runPromise = vi.fn();
vi.mock("./runtime", () => ({ runtime: { runPromise: (e: unknown) => runPromise(e) } }));

const { isEmailChangeVerification, queueWelcomeEmail, welcomeAtCreation } =
  await import("./welcome");

describe("welcomeAtCreation", () => {
  it("welcomes OAuth sign-ups (already verified) at creation", () => {
    expect(welcomeAtCreation({ emailVerified: true }, true)).toBe(true);
  });

  it("waits for verification when an email sign-up must verify", () => {
    expect(welcomeAtCreation({ emailVerified: false }, true)).toBe(false);
  });

  it("welcomes at creation when verification is switched off", () => {
    expect(welcomeAtCreation({ emailVerified: false }, false)).toBe(true);
  });
});

describe("queueWelcomeEmail", () => {
  it("enqueues for the user", async () => {
    enqueue.mockReturnValue("effect");
    runPromise.mockResolvedValue(true);
    await queueWelcomeEmail("u1");
    expect(enqueue).toHaveBeenCalledWith("u1");
    expect(runPromise).toHaveBeenCalledWith("effect");
  });

  it("swallows a failure so sign-up still succeeds", async () => {
    runPromise.mockRejectedValue(new Error("db down"));
    await expect(queueWelcomeEmail("u1")).resolves.toBeUndefined();
  });
});

describe("isEmailChangeVerification", () => {
  const token = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const req = (t?: string) =>
    new Request(`https://app.example/api/auth/verify-email${t ? `?token=${t}` : ""}`);

  it("is true for a change-email token (updateTo set)", () => {
    expect(isEmailChangeVerification(req(token({ email: "a@b.c", updateTo: "n@b.c" })))).toBe(true);
  });

  it("is false for a sign-up token, a missing token and garbage", () => {
    expect(isEmailChangeVerification(req(token({ email: "a@b.c" })))).toBe(false);
    expect(isEmailChangeVerification(req())).toBe(false);
    expect(isEmailChangeVerification(req("not-a-jwt"))).toBe(false);
    expect(isEmailChangeVerification(undefined)).toBe(false);
  });
});
