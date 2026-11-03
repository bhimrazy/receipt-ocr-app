import { asc, desc, eq, member, organization, rateLimit, sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import type { ReceiptScope } from "./repository";
import { Db } from "./services";

/**
 * The workspace a request acts in, resolved through `member` on every call.
 * The session's activeOrganizationId is only a preference: Better Auth does
 * not clear it on other sessions when a member is removed, so trusting it
 * would let removed members keep access. A stale preference falls back to the
 * user's oldest remaining membership; no membership means no scope.
 */
export const resolveScope = (userId: string, preferredOrganizationId?: string | null) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<Required<ReceiptScope> | null> => {
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

const nameFor = (user: { name?: string | null; email: string }) =>
  `${user.name?.trim() || user.email.split("@")[0] || "Personal"}'s Workspace`;

/**
 * Creates the user's personal workspace and owner membership in one
 * transaction, so a failure can't leave an org without its owner. Idempotent:
 * returns null when the personal workspace already exists.
 */
export const ensurePersonalWorkspace = (user: { id: string; name?: string | null; email: string }) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db) =>
      db.transaction(async (tx) => {
        const now = new Date();
        const [org] = await tx
          .insert(organization)
          .values({ id: crypto.randomUUID(), name: nameFor(user), slug: slugFor(user.id), createdAt: now })
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

/**
 * Fixed-window counter in Better Auth's rate_limit table, so limits hold
 * across serverless instances. Our rows use the key as id, which never
 * collides with Better Auth's generated ids.
 */
export const hitRateLimit = (key: string, windowMs: number, max: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const now = Date.now();
      const expired = sql`${rateLimit.lastRequest} < ${now - windowMs}`;
      const [row] = await db
        .insert(rateLimit)
        .values({ id: key, key, count: 1, lastRequest: now })
        .onConflictDoUpdate({
          target: rateLimit.id,
          set: {
            count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
            lastRequest: sql`case when ${expired} then ${now} else ${rateLimit.lastRequest} end`,
          },
        })
        .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });
      const count = row?.count ?? 1;
      const windowStart = row?.lastRequest ?? now;
      return {
        allowed: count <= max,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
      };
    }),
  );
