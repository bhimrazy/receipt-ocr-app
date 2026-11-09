import { Billing } from "@receipt-ocr/core";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeSession = {
  user: { id: string; email: string; role: string };
  session: { impersonatedBy?: string };
};

let session: FakeSession;
let scope: { organizationId: string; userId: string; role: string };
const createCheckout = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("@/lib/session", () => ({
  getSession: async () => session,
  requireActiveScope: async () => scope,
  isAdmin: (s: FakeSession | null) => s?.user.role === "admin",
}));
vi.mock("@/lib/receipts", () => ({ getUsageSummary: async () => null }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, errorFields: () => ({}) }));
// The rate limit always passes; Billing is a fake whose createCheckout records its calls.
vi.mock("@/lib/runtime", () => ({
  runtime: {
    runPromise: async () => ({ allowed: true }),
    runPromiseExit: (effect: Effect.Effect<unknown, unknown, Billing>) =>
      Effect.runPromiseExit(
        Effect.provideService(effect, Billing, {
          createCheckout: (request: unknown) =>
            Effect.sync(() => {
              createCheckout(request);
              return { transactionId: "txn_1" };
            }),
        } as never),
      ),
  },
}));

const { startCheckoutAction } = await import("./actions");

const ORG = "org_1";

beforeEach(() => {
  createCheckout.mockClear();
  session = { user: { id: "u_1", email: "owner@example.com", role: "user" }, session: {} };
  scope = { organizationId: ORG, userId: "u_1", role: "owner" };
  // Paddle's public settings, live keys, off Vercel: the checkout is open to everyone.
  vi.stubEnv("PADDLE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "live_x");
  vi.stubEnv("PADDLE_PRICE_PRO_MONTHLY", "pri_m");
  vi.stubEnv("PADDLE_PRICE_PRO_YEARLY", "pri_y");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => vi.unstubAllEnvs());

/** Sandbox keys on the live site. */
const sandboxOnProduction = () => {
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("VERCEL_ENV", "production");
};

describe("startCheckoutAction", () => {
  it("creates the checkout for the owner of the active workspace", async () => {
    expect(await startCheckoutAction("year", "meter", ORG)).toEqual({
      ok: true,
      transactionId: "txn_1",
    });
    expect(createCheckout).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: "u_1",
      email: "owner@example.com",
      interval: "year",
    });
  });

  it("lets a platform admin who owns the workspace check out on sandbox keys on the live site", async () => {
    sandboxOnProduction();
    session.user.role = "admin";
    expect((await startCheckoutAction("month", "billing", ORG)).ok).toBe(true);
    expect(createCheckout).toHaveBeenCalledOnce();
  });

  it.each([
    ["a member", () => (scope.role = "member"), "Only the workspace owner can manage billing."],
    [
      "a workspace admin who isn't the owner",
      () => (scope.role = "admin"),
      "Only the workspace owner can manage billing.",
    ],
    [
      "an owner while an admin is signed in as them",
      () => (session.session.impersonatedBy = "admin_1"),
      "Billing can't be managed while signed in as another user.",
    ],
    [
      "a non-admin on sandbox keys on the live site",
      sandboxOnProduction,
      "Paid plans aren't open yet.",
    ],
  ])("refuses %s without calling Paddle", async (_who, arrange, error) => {
    arrange();
    expect(await startCheckoutAction("month", "home", ORG)).toEqual({ ok: false, error });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses a `via` outside the closed set", async () => {
    const result = await startCheckoutAction("month", "evil" as never, ORG);
    expect(result.ok).toBe(false);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses when the page named another workspace than the active one", async () => {
    expect(await startCheckoutAction("month", "home", "org_other")).toEqual({
      ok: false,
      error: "Your active workspace changed. Reload and try again.",
    });
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
