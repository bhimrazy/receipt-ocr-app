import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KEYS = [
  "NODE_ENV",
  "NEXT_PHASE",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_SECRETS",
  "TRUSTED_IP_HEADERS",
  "TRUSTED_PROXIES",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_ALLOWED_HOSTNAMES",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "SUPPORT_EMAIL",
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

describe("app URL and trusted origins", () => {
  const vercel = {
    ...production,
    VERCEL: "1",
    VERCEL_URL: "receipt-ocr-abc123-team.vercel.app",
    VERCEL_BRANCH_URL: "receipt-ocr-git-feature-team.vercel.app",
  };
  const preview = { ...vercel, VERCEL_ENV: "preview", BETTER_AUTH_URL: "" };

  it("uses exactly BETTER_AUTH_URL in production and never the Vercel hosts", async () => {
    const env = await loadEnv({ ...vercel, VERCEL_ENV: "production" });
    expect(env.authEnv.betterAuthUrl).toBe("https://app.example");
    expect(env.authEnv.trustedOrigins).toEqual(["https://app.example"]);
    await expect(
      loadEnv({ ...vercel, VERCEL_ENV: "production", BETTER_AUTH_URL: "" }),
    ).rejects.toThrow(/BETTER_AUTH_URL must be set in production/);
  });

  it("derives a preview's URL from its branch alias and trusts both hosts", async () => {
    const env = await loadEnv(preview);
    expect(env.authEnv.betterAuthUrl).toBe("https://receipt-ocr-git-feature-team.vercel.app");
    expect(env.authEnv.trustedOrigins).toEqual([
      "https://receipt-ocr-git-feature-team.vercel.app",
      "https://receipt-ocr-abc123-team.vercel.app",
    ]);
  });

  it("falls back to the deployment host when a preview has no branch alias", async () => {
    const env = await loadEnv({ ...preview, VERCEL_BRANCH_URL: "" });
    expect(env.authEnv.betterAuthUrl).toBe("https://receipt-ocr-abc123-team.vercel.app");
    expect(env.authEnv.trustedOrigins).toEqual(["https://receipt-ocr-abc123-team.vercel.app"]);
  });

  it("keeps an explicit BETTER_AUTH_URL on a preview and still trusts the preview hosts", async () => {
    const env = await loadEnv({ ...preview, BETTER_AUTH_URL: "https://staging.example" });
    expect(env.authEnv.betterAuthUrl).toBe("https://staging.example");
    expect(env.authEnv.trustedOrigins).toEqual([
      "https://staging.example",
      "https://receipt-ocr-git-feature-team.vercel.app",
      "https://receipt-ocr-abc123-team.vercel.app",
    ]);
  });

  it("pins Turnstile to every trusted host on a preview", async () => {
    const env = await loadEnv({
      ...preview,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
    });
    expect(env.turnstileEnv?.allowedHostnames).toEqual([
      "receipt-ocr-git-feature-team.vercel.app",
      "receipt-ocr-abc123-team.vercel.app",
    ]);
  });

  it("defaults to localhost in local development, ignoring a stray VERCEL_URL", async () => {
    const env = await loadEnv({ NODE_ENV: "development", VERCEL_URL: "x.vercel.app" });
    expect(env.authEnv.betterAuthUrl).toBe("http://localhost:3000");
    expect(env.authEnv.trustedOrigins).toEqual(["http://localhost:3000"]);
  });
});

describe("build with Vercel Sensitive placeholders", () => {
  // `vercel pull` can't read Sensitive values back, so the build sees placeholders or nothing.
  const placeholder = "[sensitive]";
  const build = {
    NODE_ENV: "production",
    NEXT_PHASE: "phase-production-build",
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: placeholder,
    BETTER_AUTH_URL: placeholder,
    BETTER_AUTH_SECRET: placeholder,
    BETTER_AUTH_SECRETS: placeholder,
    TRUSTED_PROXIES: placeholder,
    GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "",
    TURNSTILE_SECRET_KEY: placeholder,
  };

  it("never throws on runtime-only secrets and treats malformed ones as unset", async () => {
    const env = await loadEnv(build);
    expect(env.authEnv).toMatchObject({
      databaseUrl: undefined,
      betterAuthSecrets: undefined,
      betterAuthUrl: "http://localhost:3000",
      google: undefined,
    });
    expect(env.authEnv.ipAddress.trustedProxies).toBeUndefined();
    expect(env.turnstileEnv).toBeUndefined();
  });

  it("builds with every secret missing", async () => {
    await expect(
      loadEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", VERCEL: "1" }),
    ).resolves.toBeDefined();
  });

  it("still refuses the same values when the server starts", async () => {
    const runtime = { ...production, VERCEL: "1" };
    const cases: [Record<string, string>, RegExp][] = [
      [{ BETTER_AUTH_SECRETS: placeholder }, /BETTER_AUTH_SECRETS/],
      [{ DATABASE_URL: placeholder }, /DATABASE_URL is not a valid/],
      [{ BETTER_AUTH_URL: placeholder }, /BETTER_AUTH_URL must be an absolute URL/],
      [{ TRUSTED_PROXIES: placeholder }, /TRUSTED_PROXIES/],
      [{ GOOGLE_CLIENT_ID: "id" }, /Incomplete GOOGLE OAuth config/],
    ];
    for (const [vars, error] of cases) {
      await expect(loadEnv({ ...runtime, ...vars })).rejects.toThrow(error);
    }
  });

  it("keeps valid values during the build", async () => {
    const env = await loadEnv({ ...production, NEXT_PHASE: "phase-production-build" });
    expect(env.authEnv.databaseUrl).toBe(production.DATABASE_URL);
    expect(env.authEnv.betterAuthUrl).toBe(production.BETTER_AUTH_URL);
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

describe("SUPPORT_EMAIL", () => {
  it("accepts a bare address", async () => {
    const env = await loadEnv({ SUPPORT_EMAIL: "help@example.com" });
    expect(env.supportEmail).toBe("help@example.com");
    expect(env.emailEnv.replyTo).toBe("help@example.com");
  });

  it("treats a display-name form as unset, with a warning", async () => {
    const env = await loadEnv({ SUPPORT_EMAIL: "Support <help@example.com>" });
    expect(env.supportEmail).toBeUndefined();
    expect(env.emailEnv.replyTo).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SUPPORT_EMAIL"));
  });
});
