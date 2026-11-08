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
