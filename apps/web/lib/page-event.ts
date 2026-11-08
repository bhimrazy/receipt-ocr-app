import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { logger, takeFailedRender, type WideEvent } from "./log";
import { REQUESTED_PATH_HEADER } from "./redirect";
import { REQUEST_ID_HEADER } from "./request-id";
import { launchedFromPwa, PWA_SOURCE } from "./signed-in-hint";
import { getActiveScope, getSession } from "./session";

/**
 * Writes one `page.render` event for this server render of an /app or /admin
 * page, after the response has finished streaming. Call it first in the page
 * with the route pattern: `logPageRender("/app/receipts/[id]")`.
 *
 * It costs no query of its own: the session and scope are the ones the
 * layout already loaded (React `cache()` dedupes them per request). A render
 * that threw is reported by `onRequestError`, which leaves the error here
 * under the request id proxy.ts set. Successful renders are routine and
 * sampled at LOG_SAMPLE_RATE.
 */
export function logPageRender(route: string): void {
  const startedAt = Date.now();
  const event: WideEvent = { event: "page.render", unit: "page", route };
  // Started during the render, where request APIs are allowed; read in after().
  const context = Promise.all([
    headers(),
    getSession(),
    route.startsWith("/app") ? getActiveScope() : null,
  ]).catch(() => null);

  after(async () => {
    event.duration_ms = Date.now() - startedAt;
    const resolved = await context;
    const requestId = resolved?.[0].get(REQUEST_ID_HEADER) ?? undefined;
    const session = resolved?.[1];
    const scope = resolved?.[2];
    event.request_id = requestId;
    // Opened from the home screen: the manifest's start_url carries ?source=pwa.
    if (launchedFromPwa(resolved?.[0].get(REQUESTED_PATH_HEADER))) event.launch_source = PWA_SOURCE;
    event.user_id = session?.user.id;
    event.impersonated_by = session?.session.impersonatedBy;
    event.organization_id = scope?.organizationId;
    const failure = requestId ? takeFailedRender(requestId) : undefined;
    if (failure) {
      event.outcome = "error";
      event.status_code = 500;
      event.error = failure;
    } else {
      event.outcome = "ok";
    }
    // Like ticks: a render that logged a notice is never sampled away.
    logger.emit(event, {
      routine: (event.notices?.length ?? 0) === 0 && event.launch_source === undefined,
    });
  });
}
