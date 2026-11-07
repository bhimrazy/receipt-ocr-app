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
