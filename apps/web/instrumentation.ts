import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await (await import("./instrumentation-node")).loadEnvOrExit();
  }
}

/**
 * Server render, route and action failures: the error's class and digest,
 * never its message or the request's data. A failed page render is also
 * handed to that page's `page.render` event by request id.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { errorFields, logger, noteFailedRender } = await import("./lib/log");
  const { REQUEST_ID_HEADER } = await import("./lib/request-id");
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = typeof header === "string" ? header : undefined;
  const fields = { ...errorFields(error), digest: (error as { digest?: string }).digest };
  if (requestId && context.routeType === "render") noteFailedRender(requestId, fields);
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
