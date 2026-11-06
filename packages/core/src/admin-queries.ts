import {
  adminAuditLog,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  invitation,
  member,
  or,
  organization,
  receipts,
  sql,
  user,
  type SQL,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import { policyFor, type PlanId, type PlanTable } from "./plans";
import { utcDayStart } from "./quota";
import { Db } from "./services";
import { readOkSql, receiptsReadSince, roundsSince } from "./usage";

/**
 * Reads for the admin pages. Every list is offset-paged with a total, and its
 * per-row counts are correlated subqueries, so cost scales with the page, not
 * the table.
 */

const DAY_MS = 86_400_000;
// Drizzle leaves columns unqualified in single-table selects, so correlated
// subqueries name the outer row explicitly.
const USER_ID = sql.raw(`"user"."id"`);
const ORG_ID = sql.raw(`"organization"."id"`);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** A ban past its expiry no longer applies (Better Auth lifts it on the next sign-in). */
const activeBan = sql<boolean>`(${user.banned} and (${user.banExpires} is null or ${user.banExpires} > now()))`;

/** Same rule as the quota (from the usage ledger), without receipts still being read. */
const usedSince = receiptsReadSince;

export type Page = { page: number; pageSize: number };
const offsetOf = ({ page, pageSize }: Page) => (Math.max(1, page) - 1) * pageSize;

// ---------- Overview ----------

export type NearLimitUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
  used: number;
  limit: number;
};

export type AdminOverview = {
  users: { total: number; newThisWeek: number; banned: number; unverified: number };
  workspaces: { total: number; shared: number };
  receipts: { today: number; week: number; failedToday: number; failedWeek: number };
  /** Oldest first, one entry per UTC day, today last. */
  daily: { day: string; completed: number; failed: number }[];
  /** Provider calls today (uploads + retries), the number OCR_DAILY_CAP is checked against. */
  readsToday: number;
  nearLimit: NearLimitUser[];
  recentSignups: {
    id: string;
    name: string;
    email: string;
    plan: string;
    emailVerified: boolean;
    createdAt: Date;
  }[];
};

export const adminOverview = (plans: PlanTable, now = new Date()) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<AdminOverview> => {
      const today = utcDayStart(now);
      const weekStart = new Date(today.getTime() - 6 * DAY_MS);
      const chartStart = new Date(today.getTime() - 13 * DAY_MS);

      const [users] = await db
        .select({
          total: sql<number>`count(*)::int`,
          newThisWeek: sql<number>`(count(*) filter (where ${user.createdAt} >= ${ts(weekStart)}))::int`,
          banned: sql<number>`(count(*) filter (where ${activeBan}))::int`,
          unverified: sql<number>`(count(*) filter (where not ${user.emailVerified}))::int`,
        })
        .from(user);

      const [workspaces] = await db
        .select({
          total: sql<number>`count(*)::int`,
          shared: sql<number>`(count(*) filter (where (select count(*) from ${member} m where m.organization_id = ${ORG_ID}) > 1))::int`,
        })
        .from(organization);

      const daily = await db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${receipts.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
          completed: sql<number>`(count(*) filter (where ${receipts.status} <> 'failed'))::int`,
          failed: sql<number>`(count(*) filter (where ${receipts.status} = 'failed'))::int`,
        })
        .from(receipts)
        .where(sql`${receipts.createdAt} >= ${ts(chartStart)}`)
        .groupBy(sql`1`);

      const [reads] = await db.execute<{ value: number }>(
        sql`select ${roundsSince(today)} as value`,
      );

      // Anyone at 80% of the smallest daily limit is a candidate; their own plan decides.
      const threshold = Math.ceil(
        Math.min(...Object.values(plans).map((p) => p.receiptsPerDay)) * 0.8,
      );
      const heavy = await db.execute<{
        id: string;
        name: string;
        email: string;
        plan: string;
        used: number;
      }>(sql`select u.id, u.name, u.email, u.plan, count(distinct r.receipt_id)::int as used
        from ocr_rounds r join "user" u on u.id = r.user_id
        where r.created_at >= ${ts(today)} and ${readOkSql}
        group by u.id
        having count(distinct r.receipt_id) >= ${threshold}
        order by used desc
        limit 50`);

      const nearLimit = heavy
        .map((row) => ({ ...row, limit: policyFor(plans, row.plan).receiptsPerDay }))
        .filter((row) => row.used >= row.limit * 0.8)
        .sort((a, b) => b.used / b.limit - a.used / a.limit)
        .slice(0, 8);

      const recentSignups = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          plan: user.plan,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
        })
        .from(user)
        .orderBy(desc(user.createdAt))
        .limit(6);

      const byDay = new Map(daily.map((d) => [d.day, d]));
      const days = Array.from({ length: 14 }, (_, i) => {
        const day = new Date(chartStart.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        return {
          day,
          completed: byDay.get(day)?.completed ?? 0,
          failed: byDay.get(day)?.failed ?? 0,
        };
      });
      const sum = (from: number, key: "completed" | "failed") =>
        days.slice(from).reduce((total, d) => total + d[key], 0);
      const todayRow = days[days.length - 1]!;

      return {
        users: users ?? { total: 0, newThisWeek: 0, banned: 0, unverified: 0 },
        workspaces: workspaces ?? { total: 0, shared: 0 },
        receipts: {
          today: todayRow.completed + todayRow.failed,
          week: sum(7, "completed") + sum(7, "failed"),
          failedToday: todayRow.failed,
          failedWeek: sum(7, "failed"),
        },
        daily: days,
        readsToday: reads?.value ?? 0,
        nearLimit,
        recentSignups,
      };
    }),
  );

// ---------- Users ----------

export type UserSort = "joined" | "name" | "usage";
export type UserFilters = {
  q?: string;
  role?: "admin" | "user";
  plan?: PlanId;
  status?: "active" | "banned" | "unverified";
  sort?: UserSort;
  dir?: "asc" | "desc";
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  plan: string;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  emailVerified: boolean;
  createdAt: Date;
  usedToday: number;
  workspaces: number;
};

export const listUsers = (filters: UserFilters, page: Page, now = new Date()) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const conditions: (SQL | undefined)[] = [];
      const q = filters.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(or(ilike(user.email, pattern), ilike(user.name, pattern)));
      }
      if (filters.role) conditions.push(eq(user.role, filters.role));
      if (filters.plan) conditions.push(eq(user.plan, filters.plan));
      if (filters.status === "banned") conditions.push(activeBan);
      if (filters.status === "unverified") conditions.push(eq(user.emailVerified, false));
      if (filters.status === "active") {
        conditions.push(and(sql`not ${activeBan}`, eq(user.emailVerified, true)));
      }
      const where = and(...conditions);
      const usedToday = usedSince(USER_ID, utcDayStart(now));
      const direction = filters.dir === "asc" ? asc : desc;
      const order =
        filters.sort === "name"
          ? direction(sql`lower(coalesce(nullif(${user.name}, ''), ${user.email}))`)
          : filters.sort === "usage"
            ? direction(usedToday)
            : direction(user.createdAt);

      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          plan: user.plan,
          banned: activeBan,
          banReason: user.banReason,
          banExpires: user.banExpires,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          usedToday,
          workspaces: sql<number>`(select count(*)::int from ${member} m where m.user_id = ${USER_ID})`,
        })
        .from(user)
        .where(where)
        .orderBy(order, asc(user.id))
        .limit(page.pageSize)
        .offset(offsetOf(page));
      const [total] = await db.select({ value: count() }).from(user).where(where);
      return { rows: rows satisfies AdminUserRow[], total: Number(total?.value ?? 0) };
    }),
  );

export type AdminUserDetail = AdminUserRow & {
  workspaces: number;
  memberships: {
    organizationId: string;
    name: string;
    role: string;
    members: number;
    joinedAt: Date;
  }[];
  receipts: { total: number; week: number; failed: number };
  recent: {
    id: string;
    merchant: string | null;
    status: string;
    total: string | null;
    currency: string | null;
    createdAt: Date;
    workspace: string;
  }[];
};

export const userDetail = (id: string, now = new Date()) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<AdminUserDetail | null> => {
      const today = utcDayStart(now);
      const [row] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          plan: user.plan,
          banned: activeBan,
          banReason: user.banReason,
          banExpires: user.banExpires,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          usedToday: usedSince(USER_ID, today),
        })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      if (!row) return null;

      const memberships = await db
        .select({
          organizationId: organization.id,
          name: organization.name,
          role: member.role,
          joinedAt: member.createdAt,
          members: sql<number>`(select count(*)::int from ${member} m where m.organization_id = ${ORG_ID})`,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, id))
        .orderBy(asc(member.createdAt));

      const [counts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          week: sql<number>`(count(*) filter (where ${receipts.createdAt} >= ${ts(new Date(today.getTime() - 6 * DAY_MS))}))::int`,
          failed: sql<number>`(count(*) filter (where ${receipts.status} = 'failed'))::int`,
        })
        .from(receipts)
        .where(eq(receipts.userId, id));

      const recent = await db
        .select({
          id: receipts.id,
          merchant: receipts.merchant,
          status: receipts.status,
          total: receipts.total,
          currency: receipts.currency,
          createdAt: receipts.createdAt,
          workspace: organization.name,
        })
        .from(receipts)
        .innerJoin(organization, eq(organization.id, receipts.organizationId))
        .where(eq(receipts.userId, id))
        .orderBy(desc(receipts.createdAt))
        .limit(5);

      return {
        ...row,
        workspaces: memberships.length,
        memberships,
        receipts: counts ?? { total: 0, week: 0, failed: 0 },
        recent,
      };
    }),
  );

// ---------- Workspaces ----------

export type WorkspaceSort = "created" | "name" | "receipts";

export type AdminWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  members: number;
  receipts: number;
  receiptsToday: number;
};

const firstOwner = (column: "id" | "name" | "email") =>
  sql<
    string | null
  >`(select u.${sql.raw(column)} from ${member} m join ${user} u on u.id = m.user_id where m.organization_id = ${ORG_ID} and m.role = 'owner' order by m.created_at limit 1)`;

export const listWorkspaces = (
  filters: { q?: string; sort?: WorkspaceSort; dir?: "asc" | "desc" },
  page: Page,
  now = new Date(),
) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const q = filters.q?.trim();
      const pattern = q ? `%${escapeLike(q)}%` : null;
      // Also matches by owner email: admins usually know the person, not the workspace.
      const where = pattern
        ? or(
            ilike(organization.name, pattern),
            ilike(organization.slug, pattern),
            sql`exists (select 1 from ${member} m join ${user} u on u.id = m.user_id where m.organization_id = ${ORG_ID} and m.role = 'owner' and u.email ilike ${pattern})`,
          )
        : undefined;
      const receiptsTotal = sql<number>`(select count(*)::int from ${receipts} r where r.organization_id = ${ORG_ID})`;
      const direction = filters.dir === "asc" ? asc : desc;
      const order =
        filters.sort === "name"
          ? direction(sql`lower(${organization.name})`)
          : filters.sort === "receipts"
            ? direction(receiptsTotal)
            : direction(organization.createdAt);
      const rows = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          createdAt: organization.createdAt,
          ownerId: firstOwner("id"),
          ownerName: firstOwner("name"),
          ownerEmail: firstOwner("email"),
          members: sql<number>`(select count(*)::int from ${member} m where m.organization_id = ${ORG_ID})`,
          receipts: receiptsTotal,
          receiptsToday: sql<number>`(select count(*)::int from ${receipts} r where r.organization_id = ${ORG_ID} and r.created_at >= ${ts(utcDayStart(now))})`,
        })
        .from(organization)
        .where(where)
        .orderBy(order, asc(organization.id))
        .limit(page.pageSize)
        .offset(offsetOf(page));
      const [total] = await db.select({ value: count() }).from(organization).where(where);
      return { rows: rows satisfies AdminWorkspaceRow[], total: Number(total?.value ?? 0) };
    }),
  );

export type AdminWorkspaceDetail = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  members: {
    memberId: string;
    userId: string;
    name: string;
    email: string;
    role: string;
    joinedAt: Date;
    receipts: number;
  }[];
  invitations: {
    id: string;
    email: string;
    role: string | null;
    expiresAt: Date;
    createdAt: Date;
    inviterEmail: string | null;
  }[];
  receipts: { total: number; today: number; week: number; failed: number; formerMembers: number };
};

export const workspaceDetail = (id: string, now = new Date()) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<AdminWorkspaceDetail | null> => {
      const [org] = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(eq(organization.id, id))
        .limit(1);
      if (!org) return null;
      const today = utcDayStart(now);

      const members = await db
        .select({
          memberId: member.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
          joinedAt: member.createdAt,
          receipts: sql<number>`(select count(*)::int from ${receipts} r where r.organization_id = ${id} and r.user_id = ${user.id})`,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, id))
        .orderBy(
          sql`case ${member.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
          asc(member.createdAt),
        );

      const invitations = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviterEmail: user.email,
        })
        .from(invitation)
        .leftJoin(user, eq(user.id, invitation.inviterId))
        .where(
          and(
            eq(invitation.organizationId, id),
            eq(invitation.status, "pending"),
            sql`${invitation.expiresAt} > now()`,
          ),
        )
        .orderBy(desc(invitation.createdAt));

      const [counts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          today: sql<number>`(count(*) filter (where ${receipts.createdAt} >= ${ts(today)}))::int`,
          week: sql<number>`(count(*) filter (where ${receipts.createdAt} >= ${ts(new Date(today.getTime() - 6 * DAY_MS))}))::int`,
          failed: sql<number>`(count(*) filter (where ${receipts.status} = 'failed'))::int`,
          formerMembers: sql<number>`(count(*) filter (where ${receipts.userId} is null))::int`,
        })
        .from(receipts)
        .where(eq(receipts.organizationId, id));

      return {
        ...org,
        members,
        invitations,
        receipts: counts ?? { total: 0, today: 0, week: 0, failed: 0, formerMembers: 0 },
      };
    }),
  );

// ---------- Audit log ----------

export type AuditFilters = {
  targetType?: "user" | "workspace" | "settings";
  targetId?: string;
  q?: string;
};

export const listAudit = (filters: AuditFilters, page: Page) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const conditions: (SQL | undefined)[] = [];
      if (filters.targetType) conditions.push(eq(adminAuditLog.targetType, filters.targetType));
      if (filters.targetId) conditions.push(eq(adminAuditLog.targetId, filters.targetId));
      const q = filters.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(
          or(
            ilike(adminAuditLog.actorEmail, pattern),
            ilike(adminAuditLog.targetLabel, pattern),
            ilike(adminAuditLog.action, pattern),
            ilike(adminAuditLog.reason, pattern),
          ),
        );
      }
      const where = and(...conditions);
      const rows = await db
        .select()
        .from(adminAuditLog)
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
        .limit(page.pageSize)
        .offset(offsetOf(page));
      const [total] = await db.select({ value: count() }).from(adminAuditLog).where(where);
      return { rows, total: Number(total?.value ?? 0) };
    }),
  );

// ---------- Action targets ----------

export type AdminTargetUser = {
  id: string;
  email: string;
  role: string | null;
  emailVerified: boolean;
};

/** The fields an admin action checks before acting on a user; null when the user is gone. */
export const findUser = (id: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<AdminTargetUser | null> => {
      const [row] = await db
        .select({
          id: user.id,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
        })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      return row ?? null;
    }),
  );

export const findWorkspace = (id: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const [row] = await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(eq(organization.id, id))
        .limit(1);
      return row ?? null;
    }),
  );
