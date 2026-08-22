import { createDb, sql } from "@receipt-ocr/db";
import { authEnv } from "@/lib/env";
import { planPolicy } from "@/lib/plans";

/**
 * Per-plan upload limits. `/api/receipts` is an unmetered call to a paid OCR
 * provider, so it needs a ceiling that does not depend on the client behaving.
 * Better Auth's rate limiter only covers its own endpoints, so we count real
 * rows instead: it is accurate across serverless instances and survives
 * restarts, unlike an in-memory counter.
 */
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
  const limits = planPolicy(plan);
  if (!authEnv.databaseUrl) return { allowed: true, limit: limits.receiptsPerDay, used: 0 };

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

  if (perMinute >= limits.receiptsPerMinute) {
    return {
      allowed: false,
      window: "minute",
      limit: limits.receiptsPerMinute,
      used: perMinute,
      retryAfterSeconds: 60,
    };
  }
  if (perDay >= limits.receiptsPerDay) {
    return {
      allowed: false,
      window: "day",
      limit: limits.receiptsPerDay,
      used: perDay,
      retryAfterSeconds: 60 * 60,
    };
  }
  return { allowed: true, limit: limits.receiptsPerDay, used: perDay };
}

export function quotaMessage(verdict: QuotaVerdict): string {
  if (verdict.window === "minute") {
    return `Too many uploads at once — you can process ${verdict.limit} receipts per minute. Try again shortly.`;
  }
  return `You've reached your daily limit of ${verdict.limit} receipts. It resets on a rolling 24-hour window.`;
}
