import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parsePaddleConfig, parsePublicPaddleConfig } from "./config";
import { loadCheckoutConfig } from "./service";

/** What `vercel pull` gives a CI build: Sensitive values (the API key, the webhook secret) empty. */
const buildEnv = {
  PADDLE_ENV: "production",
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_client_token",
  PADDLE_PRICE_PRO_MONTHLY: "pri_month",
  PADDLE_PRICE_PRO_YEARLY: "pri_year",
  PADDLE_API_KEY: "",
  PADDLE_WEBHOOK_SECRET: "",
};

const withEnv = <A>(effect: Effect.Effect<A>, env: Record<string, string>) =>
  Effect.runPromise(
    Effect.withConfigProvider(effect, ConfigProvider.fromMap(new Map(Object.entries(env)))),
  );

describe("Paddle config at build time", () => {
  it("opens the checkout from non-secret values alone, with the secrets empty", async () => {
    expect(parsePublicPaddleConfig(buildEnv)).toEqual({
      environment: "production",
      clientToken: "live_client_token",
      prices: { month: "pri_month", year: "pri_year" },
    });
    expect(await withEnv(loadCheckoutConfig, buildEnv)).toEqual({
      provider: "paddle",
      environment: "production",
      clientToken: "live_client_token",
    });
    // The full config (server actions, webhook) still needs the secrets.
    expect(parsePaddleConfig(buildEnv)).toBeNull();
  });

  it("stays off when a public value is missing or PADDLE_ENV is unknown", async () => {
    expect(await withEnv(loadCheckoutConfig, { ...buildEnv, PADDLE_PRICE_PRO_YEARLY: "" })).toBe(
      null,
    );
    expect(parsePublicPaddleConfig({ ...buildEnv, PADDLE_ENV: "live" })).toBeNull();
  });
});
