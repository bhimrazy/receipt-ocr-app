import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ authEnv: { betterAuthUrl: "https://app.example", ipAddress: {} } }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logger: { emit, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ auth: {}, authEnabled: true }));
// Better Auth answers callbacks, verification and resets with redirects, failures included.
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({
    GET: async () => new Response(null, { status: 302, headers: { location: "/sign-in?error=x" } }),
    POST: async () => new Response(null, { status: 429 }),
  }),
}));

const { GET, POST } = await import("./route");

beforeEach(() => emit.mockReset());

async function routineOf(path: string) {
  await GET(new Request(`https://app.example${path}`));
  expect(emit).toHaveBeenCalledTimes(1);
  const [event, options] = emit.mock.calls[0]!;
  emit.mockReset();
  return { event, routine: options.routine };
}

describe("GET /api/auth/[...all] sampling", () => {
  it("never samples OAuth callbacks, email verification or password resets", async () => {
    for (const path of [
      "/api/auth/callback/google?code=c&state=s",
      "/api/auth/verify-email?token=t",
      "/api/auth/reset-password/tok?callbackURL=/reset-password",
    ]) {
      const { event, routine } = await routineOf(path);
      expect(routine, path).toBe(false);
      expect(event).toMatchObject({ event: "auth.request", status_code: 302 });
      expect(JSON.stringify(event)).not.toMatch(/tok|code=|token=/);
    }
  });

  it("never samples a rate-limited sign-in, sign-up or password reset", async () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/sign-up/email",
      "/api/auth/forget-password",
    ]) {
      await POST(new Request(`https://app.example${path}`, { method: "POST" }));
      const [event, options] = emit.mock.calls[0]!;
      emit.mockReset();
      expect(event, path).toMatchObject({ status_code: 429 });
      expect(options.routine, path).toBe(false);
    }
  });

  it("samples session reads", async () => {
    expect((await routineOf("/api/auth/get-session")).routine).toBe(true);
  });
});
