import type { CheckoutConfig } from "@receipt-ocr/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("./env", () => ({ authEnv: { databaseUrl: undefined } }));
vi.mock("./runtime", () => ({ runtime: { runPromise: vi.fn() } }));

let loaded: CheckoutConfig | null = null;
vi.mock("@receipt-ocr/core", () => ({
  loadCheckoutConfig: "load",
  workspaceBilling: vi.fn(),
}));
vi.mock("effect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("effect")>()),
  Effect: { runPromise: async () => loaded },
}));

const { checkoutOpenToEveryone, getCheckoutFor, isTestModeOnProduction } =
  await import("./billing");

const config = (environment: "sandbox" | "production") => ({ environment }) as CheckoutConfig;

describe("sandbox checkout on the live site", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is test mode on Vercel production, and not on previews", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isTestModeOnProduction(config("sandbox"))).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestModeOnProduction(config("sandbox"))).toBe(false);
  });

  it("covers the Docker image: no VERCEL_ENV and NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestModeOnProduction(config("sandbox"))).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isTestModeOnProduction(config("sandbox"))).toBe(false);
  });

  it("never treats live keys as test mode", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isTestModeOnProduction(config("production"))).toBe(false);
  });

  it("opens the public checkout only with billing on and no sandbox on production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(checkoutOpenToEveryone(null)).toBe(false);
    expect(checkoutOpenToEveryone(config("sandbox"))).toBe(false);
    expect(checkoutOpenToEveryone(config("production"))).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(checkoutOpenToEveryone(config("sandbox"))).toBe(true);
  });

  it("gives a sandbox checkout on production to platform admins only, marked as a test", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    loaded = config("sandbox");
    expect(await getCheckoutFor(false)).toBeNull();
    expect(await getCheckoutFor(true)).toEqual({ config: loaded, testMode: true });
    loaded = null;
    expect(await getCheckoutFor(true)).toBeNull();
    loaded = config("production");
    expect(await getCheckoutFor(false)).toEqual({ config: loaded, testMode: false });
  });
});
