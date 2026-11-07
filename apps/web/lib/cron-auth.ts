import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuth = "ok" | "unauthorized" | "unconfigured";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks `Authorization: Bearer <secret>` against CRON_SECRET, as Vercel Cron
 * and pg_net send it. Without a configured secret nothing is allowed, so the
 * route is never open. Both sides are hashed first, so the comparison is
 * constant-time and the secret's length isn't revealed.
 */
export function checkCronAuth(header: string | null, secret: string | undefined): CronAuth {
  if (!secret) return "unconfigured";
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return "unauthorized";
  return timingSafeEqual(digest(match[1]!), digest(secret)) ? "ok" : "unauthorized";
}
