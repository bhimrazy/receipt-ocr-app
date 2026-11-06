import "server-only";
import { turnstileEnv } from "./env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export type TurnstileResult =
  | { ok: true }
  /** missing: no token sent; rejected: Cloudflare refused it; unavailable: could not ask. */
  | { ok: false; reason: "missing" | "rejected" | "unavailable"; errorCodes?: string[] };

export interface VerifyOptions {
  secretKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Checks a Turnstile token with Cloudflare's siteverify. Fails closed: anything other than an
 * explicit `success: true` (network error, timeout, non-2xx, bad JSON) is a failure.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp: string | null,
  { secretKey, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }: VerifyOptions,
): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: "missing" };
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        ...(remoteIp && { remoteip: remoteIp }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const body = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (body.success === true) return { ok: true };
    return { ok: false, reason: "rejected", errorCodes: body["error-codes"] };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Verifies a request's token when Turnstile is configured; passes through when it is not. */
export async function checkTurnstile(
  request: {
    headers: Headers;
  },
  remoteIp: string | null,
): Promise<TurnstileResult> {
  if (!turnstileEnv) return { ok: true };
  return verifyTurnstileToken(request.headers.get("x-captcha-response"), remoteIp, {
    secretKey: turnstileEnv.secretKey,
  });
}
