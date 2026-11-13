/**
 * The one source of plan limits: their shape and code defaults. Every limit a
 * user sees or hits reads from here, through the `Settings` service (which
 * applies what an admin saved in Admin → Settings and falls back to these).
 * Imports nothing, so client components (marketing copy, the sign-up subtitle)
 * can read the defaults without pulling in Effect or the database. The full
 * table, with how each limit is counted, is in docs/architecture/flows/billing.md.
 */

export const QUOTA_SCOPES = ["user", "workspace"] as const;
/** Who a plan's day and month limits count: each person, or the workspace's members together. */
export type QuotaScope = (typeof QUOTA_SCOPES)[number];

/**
 * Flat so the stored settings JSON and the admin audit diff stay one level
 * deep; grouped below by what each limit is for.
 */
export interface PlanPolicy {
  // Scans: the allowance, counted for `scope` in UTC calendar windows.
  /** `user`: each person, across every workspace on this plan (Free). `workspace`: shared by its members (Pro). */
  scope: QuotaScope;
  /** Scans per UTC day, for `scope`. */
  receiptsPerDay: number;
  /** Scans per UTC calendar month, for `scope`; null = no monthly limit. */
  receiptsPerMonth: number | null;

  // Platform: spend guards across everyone on the plan.
  /** Scans per UTC day across every user on this plan together; null = none. */
  poolPerDay: number | null;

  // Abuse and device limits, per user.
  /** Burst ceiling per user per rolling minute. */
  receiptsPerMinute: number;
  /** Images in one upload batch (camera tray plus picked files). A client-side cap; the limits above still apply per upload. */
  batchMax: number;

  // Account and workspace.
  /** Workspaces a user on this account plan may own. */
  workspaces: number;
  /**
   * Members of a workspace on this plan, counting pending invitations. Checked when someone is
   * invited and when an invitation is accepted; a workspace already past it keeps its members.
   */
  membersPerWorkspace: number;
}

/**
 * Failed reads per window (day or month) that don't count toward its limit.
 * Past this, each failed round counts like a receipt: every one is a paid
 * model call, so endless junk uploads can't run up cost for free.
 */
export const FREE_FAILED_ROUNDS = 5;

export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PlanTable = Record<PlanId, PlanPolicy>;

export const DEFAULT_PLAN: PlanId = "free";

export const DEFAULT_BATCH_MAX = 10;
/**
 * The most an admin can allow in one batch. Every photo is decoded, edited and encoded on the
 * phone before upload, and a bigger batch holds more full-size captures in memory at once.
 */
export const MAX_BATCH = 20;

/**
 * The most `membersPerWorkspace` may be set to: Better Auth's own membership
 * limit (100 by default), which still runs when an invitation is accepted.
 */
export const MAX_MEMBERS = 100;

export const DEFAULT_PLANS: PlanTable = {
  // Per person across all their workspaces: 20 a day, 30 a month (accounts from before launch
  // keep EARLY_ACCESS), and 300 a day for every Free user together.
  free: {
    scope: "user",
    receiptsPerDay: 20,
    receiptsPerMonth: 30,
    poolPerDay: 300,
    receiptsPerMinute: 10,
    batchMax: DEFAULT_BATCH_MAX,
    workspaces: 1,
    membersPerWorkspace: 3,
  },
  // Per workspace, shared by its members: 500 a month, up to 200 a day.
  pro: {
    scope: "workspace",
    receiptsPerDay: 200,
    receiptsPerMonth: 500,
    poolPerDay: null,
    receiptsPerMinute: 30,
    batchMax: DEFAULT_BATCH_MAX,
    workspaces: 2,
    membersPerWorkspace: 10,
  },
};

/**
 * The early-access Free allowance: accounts created before `joinedBefore` get
 * `receiptsPerMonth` a month on Free until `endsAt` (UTC instants; `endsAt` is a
 * month start, so no month is split), then the plan's own limit.
 */
// TODO(2026-11-30): set `joinedBefore` to the launch date once the owner picks it.
export const EARLY_ACCESS = {
  joinedBefore: new Date("2026-12-01T00:00:00Z"),
  endsAt: new Date("2027-03-01T00:00:00Z"),
  receiptsPerMonth: 100,
} as const;

/** The early-access terms, for a saved Free policy: null once over, or when Free already gives as much. */
export function earlyAccessOffer(
  free: PlanPolicy,
  now = new Date(),
): { receiptsPerMonth: number; thenPerMonth: number; joinedBefore: Date; endsAt: Date } | null {
  if (now >= EARLY_ACCESS.endsAt) return null;
  if (free.receiptsPerMonth === null || free.receiptsPerMonth >= EARLY_ACCESS.receiptsPerMonth)
    return null;
  return {
    receiptsPerMonth: EARLY_ACCESS.receiptsPerMonth,
    thenPerMonth: free.receiptsPerMonth,
    joinedBefore: EARLY_ACCESS.joinedBefore,
    endsAt: EARLY_ACCESS.endsAt,
  };
}

/** When an account's early-access allowance ends, or null if it has none or it has ended. */
export function earlyAccessUntil(
  accountCreatedAt: Date | string | null | undefined,
  now = new Date(),
): Date | null {
  if (!accountCreatedAt) return null;
  const created = new Date(accountCreatedAt).getTime();
  if (Number.isNaN(created) || created >= EARLY_ACCESS.joinedBefore.getTime()) return null;
  return now < EARLY_ACCESS.endsAt ? EARLY_ACCESS.endsAt : null;
}

/**
 * A plan's limits for one person: Free's per-person month raised to the early-access
 * allowance while their account has it. Never lowers a limit; shared (Pro) plans are unchanged.
 */
export function personalPolicy(
  plan: PlanId,
  policy: PlanPolicy,
  accountCreatedAt: Date | string | null | undefined,
  now = new Date(),
): { policy: PlanPolicy; earlyAccessUntil: Date | null } {
  const until = earlyAccessUntil(accountCreatedAt, now);
  if (
    !until ||
    plan !== "free" ||
    policy.scope !== "user" ||
    policy.receiptsPerMonth === null ||
    policy.receiptsPerMonth >= EARLY_ACCESS.receiptsPerMonth
  ) {
    return { policy, earlyAccessUntil: null };
  }
  return {
    policy: { ...policy, receiptsPerMonth: EARLY_ACCESS.receiptsPerMonth },
    earlyAccessUntil: until,
  };
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Unknown or missing plans get the default plan's limits, never unlimited. */
export function policyFor(plans: PlanTable, plan: string | null | undefined): PlanPolicy {
  return isPlanId(plan) ? plans[plan] : plans[DEFAULT_PLAN];
}
