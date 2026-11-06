/**
 * Single logger for the web app, following the wide-event (canonical log
 * line) pattern: each request emits exactly one context-rich JSON event.
 */

const environment = {
  service: "web",
  env: process.env.NODE_ENV ?? "development",
  commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  region: process.env.VERCEL_REGION ?? "local",
};

/**
 * Drizzle appends the bound `params:` (user text such as merchant names) to a
 * failed query's message; this drops them and caps the length for logs.
 */
export function redactDbMessage(message: string): string {
  return message.replace(/\s*params:[\s\S]*$/, " params: [redacted]").slice(0, 500);
}

export type WideEvent = Record<string, unknown>;

function emit(level: "info" | "error", event: WideEvent) {
  const line = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    ...environment,
    ...event,
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.info(line);
  }
}

export const logger = {
  info: (event: WideEvent) => emit("info", event),
  error: (event: WideEvent) => emit("error", event),
};
