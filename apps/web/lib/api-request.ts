export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

/**
 * A JSON request from the browser to one of our routes. Never throws: a refusal gives the
 * route's `error` (else `fallback`), and a network failure gives OFFLINE_MESSAGE.
 */
export async function apiRequest<T>(
  url: string,
  method: string,
  body?: unknown,
  fallback = "Something went wrong. Try again.",
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, error: json?.error ?? fallback };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: OFFLINE_MESSAGE };
  }
}
