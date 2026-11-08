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
