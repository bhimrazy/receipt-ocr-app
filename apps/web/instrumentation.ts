import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await (await import("./instrumentation-node")).loadEnvOrExit();
  }
}

/** Server render, route and action failures. Message and digest only: no request data, so no PII. */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  const { logger } = await import("./lib/log");
  const caught = error as Error & { digest?: string };
  logger.error({
    event: "request.error",
    message: caught.message,
    digest: caught.digest,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
