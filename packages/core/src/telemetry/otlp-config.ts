/**
 * Whether OTLP export is configured. Kept apart from `otlp.ts` so checking
 * it never loads the OpenTelemetry SDK.
 */
export function otlpLogsConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim(),
  );
}

/** `http/json` when asked for; otherwise `http/protobuf` (gRPC isn't bundled). */
export function otlpLogsProtocol(
  env: Record<string, string | undefined>,
): "http/protobuf" | "http/json" {
  const protocol = (
    env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL || env.OTEL_EXPORTER_OTLP_PROTOCOL
  )?.trim();
  return protocol === "http/json" ? "http/json" : "http/protobuf";
}
