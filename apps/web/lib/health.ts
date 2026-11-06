import "server-only";
import { checkReadiness, type Readiness } from "@receipt-ocr/core";
import { logger } from "./log";
import { runtime } from "./runtime";

/** Short commit SHA of the running build (Vercel sets the first; Docker can pass the second). */
export function commitSha(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : null;
}

/** One check per instance at most this often, so the public endpoint can't hammer the DB. */
const CACHE_MS = 5_000;
let cached: { at: number; result: Promise<Readiness> } | null = null;

const DOWN: Readiness = { ok: false, checks: { database: "down", storage: "down" } };

export function readiness(now = Date.now()): Promise<Readiness> {
  if (!cached || now - cached.at >= CACHE_MS) {
    // A runtime that can't build (no DATABASE_URL) rejects; report it as down.
    const result = runtime
      .runPromise(checkReadiness)
      .catch(() => DOWN)
      .then((readiness) => {
        // Logged per fresh check, not per request.
        if (!readiness.ok) logger.error({ event: "health.not_ready", checks: readiness.checks });
        return readiness;
      });
    cached = { at: now, result };
  }
  return cached.result;
}
