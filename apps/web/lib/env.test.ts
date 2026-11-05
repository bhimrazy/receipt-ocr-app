import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KEYS = [
  "NODE_ENV",
  "NEXT_PHASE",
  "VERCEL",
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_SECRETS",
  "TRUSTED_IP_HEADERS",
  "TRUSTED_PROXIES",
];

/** Imports a fresh env.ts with exactly these variables set. */
async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  for (const key of KEYS) vi.stubEnv(key, vars[key] ?? "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("./env");
}

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_URL: "https://app.example",
  BETTER_AUTH_SECRET: "s".repeat(40),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("trusted IP config (P1-2)", () => {
  it("refuses to start in production off Vercel without TRUSTED_IP_HEADERS", async () => {
    await expect(loadEnv(production)).rejects.toThrow(/TRUSTED_IP_HEADERS must be set/);
  });

  it("starts with the header set, on Vercel, at build time, or with auth off", async () => {
    await expect(
      loadEnv({ ...production, TRUSTED_IP_HEADERS: "X-Real-IP" }),
    ).resolves.toMatchObject({ authEnv: { ipAddress: { ipAddressHeaders: ["x-real-ip"] } } });
    await expect(loadEnv({ ...production, VERCEL: "1" })).resolves.toMatchObject({
      authEnv: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    });
    await expect(
      loadEnv({ ...production, NEXT_PHASE: "phase-production-build" }),
    ).resolves.toBeDefined();
    await expect(loadEnv({ ...production, DATABASE_URL: "" })).resolves.toBeDefined();
  });

  it("never passes an empty header list to Better Auth", async () => {
    const env = await loadEnv({ NODE_ENV: "development", TRUSTED_IP_HEADERS: " , " });
    expect(env.authEnv.ipAddress.ipAddressHeaders).toBeUndefined();
  });

  it("parses TRUSTED_PROXIES and rejects invalid entries", async () => {
    const env = await loadEnv({
      ...production,
      TRUSTED_IP_HEADERS: "x-forwarded-for",
      TRUSTED_PROXIES: "10.0.0.5, 10.1.0.0/24, 2001:db8::/32",
    });
    expect(env.authEnv.ipAddress.trustedProxies).toEqual([
      "10.0.0.5",
      "10.1.0.0/24",
      "2001:db8::/32",
    ]);
    for (const bad of ["10.0.0.0/33", "proxy.internal", "10.0.0.1/8/1"]) {
      await expect(
        loadEnv({ ...production, TRUSTED_IP_HEADERS: "x-forwarded-for", TRUSTED_PROXIES: bad }),
      ).rejects.toThrow(/TRUSTED_PROXIES/);
    }
  });
});
