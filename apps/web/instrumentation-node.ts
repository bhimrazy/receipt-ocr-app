/**
 * Starts OTLP export of the wide events when OTEL_EXPORTER_OTLP_ENDPOINT is
 * set. Unset, the OpenTelemetry SDK is never imported and nothing leaves the
 * process but stdout.
 */
export async function startTelemetryExport(env: Record<string, string | undefined> = process.env) {
  const { errorFields, logger, otlpLogsConfigured, shutdownEventSinks } =
    await import("@receipt-ocr/core/telemetry");
  if (!otlpLogsConfigured(env)) return;
  try {
    const { startOtlpExport } = await import("@receipt-ocr/core/telemetry/otlp");
    await startOtlpExport({ env });
  } catch (error) {
    // Export is optional: the app runs on with stdout only.
    logger.error({
      event: "telemetry.start_failed",
      unit: "log",
      kind: "otlp",
      error: errorFields(error),
    });
    return;
  }
  // Long-lived server (Docker): send what is buffered before the process stops. Next's own
  // SIGTERM handler exits the process; if none is registered, exit here once flushed.
  process.once("SIGTERM", () => {
    void shutdownEventSinks().finally(() => {
      if (process.listenerCount("SIGTERM") === 0) process.exit(143);
    });
  });
}

/**
 * Starts Sentry (server errors only) when SENTRY_DSN is a valid DSN. Unset or
 * malformed, the SDK is never imported.
 */
export async function startErrorReporting(env: Record<string, string | undefined> = process.env) {
  const { parseSentryDsn } = await import("./lib/telemetry/sentry-config");
  const sentry = parseSentryDsn(env.SENTRY_DSN);
  if (!sentry) return;
  try {
    const { startSentryServer } = await import("./lib/telemetry/sentry-server");
    startSentryServer(sentry.dsn, env);
  } catch (error) {
    const { errorFields, logger } = await import("@receipt-ocr/core/telemetry");
    logger.error({
      event: "telemetry.start_failed",
      unit: "log",
      kind: "sentry",
      error: errorFields(error),
    });
  }
}

/**
 * Loads env at boot so a production misconfiguration (lib/env.ts throws)
 * stops the server, instead of starting it and failing every auth request.
 */
export async function loadEnvOrExit() {
  try {
    await import("./lib/env");
  } catch (error) {
    // Our own config message (names of missing variables), not request data.
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "boot.env_invalid",
        unit: "log",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  }
}

/** Names what auth is missing in the server log; the sign-in pages only say it isn't set up. */
export async function logAuthNotConfigured() {
  const { authEnabled, authEnv } = await import("./lib/env");
  if (authEnabled) return;
  const { logger } = await import("./lib/log");
  logger.error({
    event: "auth.not_configured",
    unit: "log",
    checks: {
      database_url: Boolean(authEnv.databaseUrl),
      auth_secret: Boolean(authEnv.betterAuthSecret || authEnv.betterAuthSecrets),
    },
  });
}
