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

/** Hosts plain http may reach: this machine, or a compose service name (`otel-collector`). */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9][a-z0-9_-]*)$/i;

/**
 * Why the configured endpoint is refused, or null when it may be used. Plain
 * http only reaches a local or compose host, so the token in
 * OTEL_EXPORTER_OTLP_HEADERS never crosses a network in cleartext.
 */
export function otlpEndpointRefusal(
  env: Record<string, string | undefined>,
): "invalid-endpoint" | "insecure-endpoint" | null {
  const raw = (env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT)?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid-endpoint";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol !== "http:") return "invalid-endpoint";
  return LOCAL_HOST.test(url.hostname) ? null : "insecure-endpoint";
}
