import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const enqueue = vi.fn();
vi.mock("@receipt-ocr/core", () => ({ enqueueWelcomeEmail: (id: string) => enqueue(id) }));
const runPromise = vi.fn();
vi.mock("./runtime", () => ({ runtime: { runPromise: (e: unknown) => runPromise(e) } }));

const { queueWelcomeEmail, welcomeAtCreation } = await import("./welcome");

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
