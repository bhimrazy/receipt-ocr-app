/**
 * Request id header. proxy.ts sets it on every /app and /admin request
 * (replacing any the client sent), so a page's `page.render` event and an
 * `onRequestError` report for the same render share one `request_id`. API
 * routes make their own (`withRequestEvent`) and return it on the response.
 */
export const REQUEST_ID_HEADER = "x-request-id";
