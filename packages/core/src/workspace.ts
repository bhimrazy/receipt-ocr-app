import { appRateLimits, asc, desc, eq, inArray, member, organization, sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import type { ReceiptScope } from "./repository";
import { Db } from "./services";
import { personalWorkspaceName } from "./workspace-name";

/**
 * The workspace a request acts in, resolved through `member` on every call.
 * The session's activeOrganizationId is only a preference: Better Auth does
 * not clear it on other sessions when a member is removed, so trusting it
 * would let removed members keep access. A stale preference falls back to the
 * user's oldest remaining membership; no membership means no scope.
 */
export const resolveScope = (userId: string, preferredOrganizationId?: string | null) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<Required<Omit<ReceiptScope, "impersonatedBy">> | null> => {
      const [row] = await db
        .select({ organizationId: member.organizationId, role: member.role })
        .from(member)
        .where(eq(member.userId, userId))
        .orderBy(
          desc(sql`${member.organizationId} = ${preferredOrganizationId ?? ""}`),
          asc(member.createdAt),
        )
        .limit(1);
      return row ? { organizationId: row.organizationId, userId, role: row.role } : null;
    }),
  );

const slugFor = (userId: string) => userId.toLowerCase().replace(/[^a-z0-9-]/g, "-");

/**
 * Creates the user's personal workspace and owner membership in one
 * transaction, so a failure can't leave an org without its owner. Idempotent:
 * returns null when the user already belongs to any workspace. If the
 * id-based slug is held by an org the user isn't in, a random suffix keeps
 * self-heal from failing forever.
 */
export const ensurePersonalWorkspace = (user: {
  id: string;
  name?: string | null;
  email: string;
}) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db) =>
      db.transaction(async (tx) => {
        const now = new Date();
        const [existing] = await tx
          .select({ id: member.id })
          .from(member)
          .where(eq(member.userId, user.id))
          .limit(1);
        if (existing) return null;
        const base = slugFor(user.id);
        const [holder] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.slug, base))
          .limit(1);
        const slug = holder ? `${base}-${crypto.randomUUID().slice(0, 8)}` : base;
        const [org] = await tx
          .insert(organization)
          .values({
            id: crypto.randomUUID(),
            name: personalWorkspaceName(user),
            slug,
            createdAt: now,
          })
          .onConflictDoNothing({ target: organization.slug })
          .returning({ id: organization.id });
        if (!org) return null;
        await tx.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: org.id,
          userId: user.id,
          role: "owner",
          createdAt: now,
        });
        return org.id;
      }),
    ),
  );

/** Fixed-window counter in `app_rate_limits`, so limits hold across serverless instances. */
export const hitRateLimit = (key: string, windowMs: number, max: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const now = Date.now();
      const expired = sql`${appRateLimits.windowStart} < ${now - windowMs}`;
      const [row] = await db
        .insert(appRateLimits)
        .values({ key, count: 1, windowStart: now })
        .onConflictDoUpdate({
          target: appRateLimits.key,
          set: {
            count: sql`case when ${expired} then 1 else ${appRateLimits.count} + 1 end`,
            windowStart: sql`case when ${expired} then ${now} else ${appRateLimits.windowStart} end`,
          },
        })
        .returning({ count: appRateLimits.count, windowStart: appRateLimits.windowStart });
      const count = row?.count ?? 1;
      const windowStart = row?.windowStart ?? now;
      return {
        allowed: count <= max,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
      };
    }),
  );

/** Deletes a `hitRateLimit` counter, for limits a success resets (a correct sign-in). */
export const clearRateLimit = (key: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      await db.delete(appRateLimits).where(eq(appRateLimits.key, key));
    }),
  );

/** Twice the longest window any caller uses (a day), so no live window is ever cut short. */
const RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** Deletes up to `limit` counters whose window ended long ago, for `maintenance.purge`. */
export const purgeRateLimits = (limit: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const stale = sql`${appRateLimits.windowStart} < ${Date.now() - RATE_LIMIT_RETENTION_MS}`;
      const keys = db.select({ key: appRateLimits.key }).from(appRateLimits).where(stale).limit(limit);
      const deleted = await db
        .delete(appRateLimits)
        .where(sql`${inArray(appRateLimits.key, keys)} and ${stale}`)
        .returning({ key: appRateLimits.key });
      return deleted.length;
    }),
  );
