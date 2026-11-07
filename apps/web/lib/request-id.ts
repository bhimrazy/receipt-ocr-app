/**
 * Request id header. proxy.ts sets it on every /app and /admin request
 * (replacing any the client sent), so a page's `page.render` event and an
 * `onRequestError` report for the same render share one `request_id`. API
 * routes make their own (`withRequestEvent`) and return it on the response.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/** The paths proxy.ts runs on, so the only ones whose request id header is ours, not the client's. */
const PROXIED = /^\/(app|admin)(\/|$)/;

/** Whether `routePath` is under /app or /admin: proxied, and logging `page.render`. */
export const isProxiedRoute = (routePath: string) => PROXIED.test(routePath);

/**
 * The request id for an error report: the proxy's header on /app and /admin
 * (so it matches that render's `page.render`), otherwise a fresh one, because
 * on other paths the header is whatever the client sent.
 */
export function requestIdFor(
  routePath: string,
  headers: Record<string, string | string[] | undefined>,
): string {
  const header = headers[REQUEST_ID_HEADER];
  if (isProxiedRoute(routePath) && typeof header === "string" && header !== "") return header;
  return crypto.randomUUID();
}
