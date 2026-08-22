import { createDb, sql } from "@receipt-ocr/db";
import { authEnv } from "@/lib/env";

/**
 * Per-plan upload limits. `/api/receipts` is an unmetered call to a paid OCR
 * provider, so it needs a ceiling that does not depend on the client behaving.
 * Better Auth's rate limiter only covers its own endpoints, so we count real
 * rows instead: it is accurate across serverless instances and survives
 * restarts, unlike an in-memory counter.
 */
export interface PlanLimits {
  /** Receipts a user may upload per rolling 24 hours. */
  perDay: number;
  /** Burst ceiling per rolling minute. */
  perMinute: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { perDay: 50, perMinute: 10 },
  pro: { perDay: 1000, perMinute: 30 },
};

export function limitsForPlan(plan: string | undefined): PlanLimits {
  return PLAN_LIMITS[plan ?? "free"] ?? PLAN_LIMITS.free;
}

export interface QuotaVerdict {
  allowed: boolean;
  /** Which window was exhausted, when `allowed` is false. */
  window?: "minute" | "day";
  limit: number;
  used: number;
  /** Seconds until the caller should retry. */
  retryAfterSeconds?: number;
}

/**
 * Counts the caller's recent receipts in one round trip. Returns `allowed`
 * when both the burst and daily windows have room.
 */
export async function checkUploadQuota(
  userId: string,
  plan: string | undefined,
): Promise<QuotaVerdict> {
  const limits = limitsForPlan(plan);
  if (!authEnv.databaseUrl) return { allowed: true, limit: limits.perDay, used: 0 };

  const db = createDb(authEnv.databaseUrl);
  const rows = await db.execute<{ minute: string; day: string }>(sql`
    select
      count(*) filter (where created_at >= now() - interval '1 minute') as minute,
      count(*) filter (where created_at >= now() - interval '1 day') as day
    from receipts
    where user_id = ${userId}
  `);

  const row = rows[0];
  const perMinute = Number(row?.minute ?? 0);
  const perDay = Number(row?.day ?? 0);

  if (perMinute >= limits.perMinute) {
    return {
      allowed: false,
      window: "minute",
      limit: limits.perMinute,
      used: perMinute,
      retryAfterSeconds: 60,
    };
  }
  if (perDay >= limits.perDay) {
    return {
      allowed: false,
      window: "day",
      limit: limits.perDay,
      used: perDay,
      retryAfterSeconds: 60 * 60,
    };
  }
  return { allowed: true, limit: limits.perDay, used: perDay };
}

export function quotaMessage(verdict: QuotaVerdict): string {
  if (verdict.window === "minute") {
    return `Too many uploads at once — you can process ${verdict.limit} receipts per minute. Try again shortly.`;
  }
  return `You've reached your daily limit of ${verdict.limit} receipts. It resets on a rolling 24-hour window.`;
}
