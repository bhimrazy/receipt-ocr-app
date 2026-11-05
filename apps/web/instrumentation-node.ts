/**
 * Loads env at boot so a production misconfiguration (lib/env.ts throws)
 * stops the server, instead of starting it and failing every auth request.
 */
export async function loadEnvOrExit() {
  try {
    await import("./lib/env");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
