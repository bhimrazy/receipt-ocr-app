import { Billing, BillingProviderError } from "@receipt-ocr/core";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeSession = {
  user: { id: string; email: string; emailVerified: boolean; role: string };
  session: { impersonatedBy?: string };
};

let session: FakeSession;
let scope: { organizationId: string; userId: string; role: string };
const createCheckout = vi.fn();
const logError = vi.fn();
/** When set, the fake Billing's createCheckout fails with it. */
let checkoutFailure: BillingProviderError | null = null;

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("@/lib/session", () => ({
  getSession: async () => session,
  requireActiveScope: async () => scope,
  isAdmin: (s: FakeSession | null) => s?.user.role === "admin",
}));
vi.mock("@/lib/receipts", () => ({ getUsageSummary: async () => null }));
vi.mock("@/lib/log", () => ({
  logger: { error: (fields: unknown) => logError(fields) },
  errorFields: () => ({}),
}));
// The rate limit always passes; Billing is a fake whose createCheckout records its calls.
vi.mock("@/lib/runtime", () => ({
  runtime: {
    runPromise: async () => ({ allowed: true }),
    runPromiseExit: (effect: Effect.Effect<unknown, unknown, Billing>) =>
      Effect.runPromiseExit(
        Effect.provideService(effect, Billing, {
          createCheckout: (request: unknown) =>
            checkoutFailure
              ? Effect.fail(checkoutFailure)
              : Effect.sync(() => {
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
  logError.mockClear();
  checkoutFailure = null;
  session = {
    user: { id: "u_1", email: "owner@example.com", emailVerified: true, role: "user" },
    session: {},
  };
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
    [
      "an owner whose email isn't verified",
      () => (session.user.emailVerified = false),
      "Verify your email address before upgrading.",
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

  describe("when Paddle refuses", () => {
    const refused = (providerCode?: string) =>
      new BillingProviderError({
        message: "Paddle checkout request failed",
        kind: "http-400",
        ...(providerCode ? { providerCode } : {}),
      });

    it("logs Paddle's error code and shows a customer the generic message", async () => {
      checkoutFailure = refused("transaction_default_checkout_url_not_set");
      expect(await startCheckoutAction("month", "billing", ORG)).toEqual({
        ok: false,
        error: "The checkout couldn't start. Try again in a minute.",
      });
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "billing.checkout_failed",
          billing: { provider_error_code: "transaction_default_checkout_url_not_set" },
        }),
      );
    });

    it.each([
      ["transaction_default_checkout_url_not_set", /no default payment link/],
      ["checkout_url_domain_not_approved", /domain isn't approved/],
      ["transaction_checkout_url_domain_is_not_approved", /domain isn't approved/],
    ])("tells a platform admin how to fix %s", async (code, hint) => {
      session.user.role = "admin";
      checkoutFailure = refused(code);
      const result = await startCheckoutAction("month", "billing", ORG);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(hint);
    });

    it("keeps the generic message for an admin on any other failure", async () => {
      session.user.role = "admin";
      checkoutFailure = refused("invalid_field");
      expect(await startCheckoutAction("month", "billing", ORG)).toMatchObject({
        error: "The checkout couldn't start. Try again in a minute.",
      });
      checkoutFailure = refused();
      expect(await startCheckoutAction("month", "billing", ORG)).toMatchObject({
        error: "The checkout couldn't start. Try again in a minute.",
      });
    });
  });
});
