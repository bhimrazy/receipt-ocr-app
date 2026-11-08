import type { PaddleEnvironment } from "./paddle";

/**
 * Paddle settings, parsed from plain env values. Billing is on only when every
 * one is set: until then there is no checkout button, no portal link, no
 * Paddle.js and the webhook refuses everything with 503. The price ids map to
 * Pro; nothing else grants it. Pure: service.ts reads the env.
 */
export type PaddleConfig = {
  environment: PaddleEnvironment;
  apiKey: string;
  clientToken: string;
  webhookSecret: string;
  prices: { month: string; year: string };
};

export const PADDLE_ENV_KEYS = [
  "PADDLE_ENV",
  "PADDLE_API_KEY",
  "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_PRICE_PRO_MONTHLY",
  "PADDLE_PRICE_PRO_YEARLY",
] as const;

/**
 * The settings a page may read at build or prerender time (/pricing, the CSP).
 * Production builds in CI after `vercel pull`, which returns Sensitive values
 * empty, so `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` (Sensitive) are read
 * only at request time: server actions, the webhook route, the billing page.
 */
export const PADDLE_PUBLIC_KEYS = [
  "PADDLE_ENV",
  "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
  "PADDLE_PRICE_PRO_MONTHLY",
  "PADDLE_PRICE_PRO_YEARLY",
] as const;

export type PublicPaddleConfig = Pick<PaddleConfig, "environment" | "clientToken" | "prices">;

/** The checkout's public settings, from non-secret values only; null when any is missing. */
export function parsePublicPaddleConfig(
  env: Partial<Record<(typeof PADDLE_PUBLIC_KEYS)[number], string | undefined>>,
): PublicPaddleConfig | null {
  const get = (key: (typeof PADDLE_PUBLIC_KEYS)[number]) => env[key]?.trim() || null;
  const environment = get("PADDLE_ENV");
  const clientToken = get("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN");
  const month = get("PADDLE_PRICE_PRO_MONTHLY");
  const year = get("PADDLE_PRICE_PRO_YEARLY");
  if (environment !== "sandbox" && environment !== "production") return null;
  if (!clientToken || !month || !year) return null;
  return { environment, clientToken, prices: { month, year } };
}

/** Optional: comma-separated ids of retired Pro prices that existing subscriptions still pay. */
export const PADDLE_LEGACY_PRICES_KEY = "PADDLE_PRICE_PRO_LEGACY";

export type PaddleEnv = Partial<Record<(typeof PADDLE_ENV_KEYS)[number], string | undefined>>;

/** Null when any value is missing or blank, or PADDLE_ENV is neither `sandbox` nor `production`. */
export function parsePaddleConfig(env: PaddleEnv): PaddleConfig | null {
  const get = (key: (typeof PADDLE_ENV_KEYS)[number]) => env[key]?.trim() || null;
  const environment = get("PADDLE_ENV");
  const apiKey = get("PADDLE_API_KEY");
  const clientToken = get("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN");
  const webhookSecret = get("PADDLE_WEBHOOK_SECRET");
  const month = get("PADDLE_PRICE_PRO_MONTHLY");
  const year = get("PADDLE_PRICE_PRO_YEARLY");
  if (environment !== "sandbox" && environment !== "production") return null;
  if (!apiKey || !clientToken || !webhookSecret || !month || !year) return null;
  return { environment, apiKey, clientToken, webhookSecret, prices: { month, year } };
}

/**
 * The price ids that grant Pro: monthly, yearly and any legacy ones. Read on
 * their own, not from the full config, so a missing API key never turns paying
 * workspaces Free. Empty when none is set: then no subscription grants Pro.
 */
export function parseProPriceIds(
  env: Partial<
    Record<
      "PADDLE_PRICE_PRO_MONTHLY" | "PADDLE_PRICE_PRO_YEARLY" | typeof PADDLE_LEGACY_PRICES_KEY,
      string
    >
  >,
): ReadonlySet<string> {
  const ids = [
    env.PADDLE_PRICE_PRO_MONTHLY,
    env.PADDLE_PRICE_PRO_YEARLY,
    ...(env[PADDLE_LEGACY_PRICES_KEY]?.split(",") ?? []),
  ]
    .map((id) => id?.trim() ?? "")
    .filter((id) => id.length > 0);
  return new Set(ids);
}
