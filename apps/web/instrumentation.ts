import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const node = await import("./instrumentation-node");
    await node.startTelemetryExport();
    await node.loadEnvOrExit();
    await node.logAuthNotConfigured();
  }
}

/**
 * Server render, route and action failures: the error's class and digest,
 * never its message or the request's data. A failed page render is also
 * handed to that page's `page.render` event by request id.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { errorFields, logger, noteFailedRender } = await import("./lib/log");
  const { isProxiedRoute, requestIdFor } = await import("./lib/request-id");
  const requestId = requestIdFor(context.routePath, request.headers);
  const fields = errorFields(error);
  try {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") fields.digest = digest;
  } catch {
    // An unreadable digest is left out.
  }
  // Only /app and /admin renders write a page.render to pick this up; others would fill the map.
  if (context.routeType === "render" && isProxiedRoute(context.routePath)) {
    noteFailedRender(requestId, fields);
  }
  logger.error({
    event: "request.error",
    unit: "log",
    request_id: requestId,
    method: request.method,
    route: context.routePath,
    route_type: context.routeType,
    error: fields,
  });
};
