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
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_ALLOWED_HOSTNAMES",
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

describe("Turnstile config", () => {
  const dev = { NODE_ENV: "development" };

  it("is off with neither key and on with both", async () => {
    expect((await loadEnv(dev)).turnstileEnv).toBeUndefined();
    const env = await loadEnv({
      ...dev,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: " site ",
      TURNSTILE_SECRET_KEY: "secret",
    });
    expect(env.turnstileEnv).toEqual({
      siteKey: "site",
      secretKey: "secret",
      allowedHostnames: ["localhost"],
    });
  });

  it("pins hostnames to the app URL, or to TURNSTILE_ALLOWED_HOSTNAMES when set", async () => {
    const keys = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
    const pinned = await loadEnv({ ...dev, ...keys, BETTER_AUTH_URL: "https://app.example:8443" });
    expect(pinned.turnstileEnv?.allowedHostnames).toEqual(["app.example"]);
    const override = await loadEnv({
      ...dev,
      ...keys,
      TURNSTILE_ALLOWED_HOSTNAMES: "a.example, example.com",
    });
    expect(override.turnstileEnv?.allowedHostnames).toEqual(["a.example", "example.com"]);
  });

  it("refuses a single key at startup but not during the build", async () => {
    const single: Record<string, string>[] = [
      { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" },
      { TURNSTILE_SECRET_KEY: "secret" },
    ];
    for (const vars of single) {
      await expect(loadEnv({ ...dev, ...vars })).rejects.toThrow(/Incomplete Turnstile config/);
      const built = await loadEnv({ ...dev, ...vars, NEXT_PHASE: "phase-production-build" });
      expect(built.turnstileEnv).toBeUndefined();
    }
  });
});

describe("versioned auth secrets", () => {
  const dev = { NODE_ENV: "development", DATABASE_URL: production.DATABASE_URL };

  it("enables auth with BETTER_AUTH_SECRETS alone, current version first", async () => {
    const env = await loadEnv({
      ...dev,
      BETTER_AUTH_SECRETS: `2:${"n".repeat(40)}, 1:${"o".repeat(40)}`,
    });
    expect(env.authEnabled).toBe(true);
    expect(env.authEnv.betterAuthSecrets).toEqual([
      { version: 2, value: "n".repeat(40) },
      { version: 1, value: "o".repeat(40) },
    ]);
  });

  it("keeps the single BETTER_AUTH_SECRET working", async () => {
    const env = await loadEnv({ ...dev, BETTER_AUTH_SECRET: "s".repeat(40) });
    expect(env.authEnabled).toBe(true);
    expect(env.authEnv.betterAuthSecrets).toBeUndefined();
  });

  it.each(["no-version", "x:secret", "1:", "1:a,1:b"])("rejects %s", async (value) => {
    await expect(loadEnv({ ...dev, BETTER_AUTH_SECRETS: value })).rejects.toThrow(
      /BETTER_AUTH_SECRETS/,
    );
  });
});

describe("logUndeliveredMail", () => {
  it("logs full undelivered mail only in local development", async () => {
    const { logUndeliveredMail } = await loadEnv({});
    expect(logUndeliveredMail({ NODE_ENV: "development" })).toBe(true);
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "test" },
      {},
      { NODE_ENV: "development", VERCEL_ENV: "production" },
      { NODE_ENV: "development", VERCEL_ENV: "preview" },
    ]) {
      expect(logUndeliveredMail(env), JSON.stringify(env)).toBe(false);
    }
  });
});
