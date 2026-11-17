/**
 * The one source of plan limits: their shape and code defaults. Every limit a
 * user sees or hits reads from here, through the `Settings` service (which
 * applies what an admin saved in Admin → Settings and falls back to these).
 * Imports nothing, so client components (marketing copy, the sign-up subtitle)
 * can read the defaults without pulling in Effect or the database. The full
 * table, with how each limit is counted, is in docs/architecture/flows/billing.md.
 */

/** Who a plan's day and month limits count: each person, or the workspace's members together. */
export type QuotaScope = "user" | "workspace";

/**
 * Flat so the stored settings JSON and the admin audit diff stay one level
 * deep; grouped below by what each limit is for.
 */
export interface PlanPolicy {
  // Scans: the allowance, counted for `scope` in UTC calendar windows.
  /** `user`: each person, across every workspace on this plan. `workspace`: shared by its members. */
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
  /**
   * Bytes of stored receipt files a workspace on this plan may hold, in decimal units. Checked at
   * upload against the exact sum of `receipts.file_bytes`; deleting receipts frees room.
   */
  storageBytes: number;
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

/** Storage is counted and shown in decimal units, as storage is sold. */
export const MB = 1_000_000;
const GB = 1_000 * MB;

/** The most `storageBytes` may be set to: 1 TB. */
export const MAX_STORAGE_BYTES = 1_000 * GB;

const KB = 1_000;

/**
 * One size format for storage and files, in decimal units: "84 KB" under 1 MB, "4.1 MB" under
 * 10 MB, "86 MB" under 1 GB, then "4.1 GB" ("5 GB" when whole). Rounded down by default, so used
 * space never reads as the cap before it is; `up` for the room a file needs.
 */
export function formatStorage(bytes: number, round: "down" | "up" = "down"): string {
  const r = round === "down" ? Math.floor : Math.ceil;
  const fixed = (value: number, unit: string) => `${r(value * 10) / 10} ${unit}`;
  if (bytes <= 0) return "0 MB";
  if (bytes < KB) return round === "down" ? "<1 KB" : "1 KB";
  if (bytes < MB) return `${r(bytes / KB)} KB`;
  if (bytes < 10 * MB) return fixed(bytes / MB, "MB");
  if (bytes < GB) return `${r(bytes / MB)} MB`;
  return fixed(bytes / GB, "GB");
}

export const DEFAULT_PLANS: PlanTable = {
  // Per workspace, shared by its members: 50 a month, up to 20 a day, and 300 a day for every Free
  // workspace together.
  free: {
    scope: "workspace",
    receiptsPerDay: 20,
    receiptsPerMonth: 50,
    poolPerDay: 300,
    receiptsPerMinute: 10,
    batchMax: DEFAULT_BATCH_MAX,
    workspaces: 1,
    membersPerWorkspace: 2,
    storageBytes: 100 * MB,
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
    membersPerWorkspace: 5,
    storageBytes: 5 * GB,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Unknown or missing plans get the default plan's limits, never unlimited. */
export function policyFor(plans: PlanTable, plan: string | null | undefined): PlanPolicy {
  return isPlanId(plan) ? plans[plan] : plans[DEFAULT_PLAN];
}
