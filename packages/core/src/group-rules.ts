/**
 * Receipt group rules shared by the server and the browser: the colour
 * palette, limits and result types. No database or zod code here (the
 * schemas are in `group-schemas.ts`, server only), so client components can import it (`@receipt-ocr/core/group-rules`).
 */
import type { WorkspaceRole } from "./admin";
import type { ReceiptScope } from "./repository";

export const GROUP_COLORS = [
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "yellow",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const MAX_GROUPS_PER_WORKSPACE = 100;
export const MAX_GROUPS_PER_RECEIPT = 20;
/** Receipt ids accepted by one bulk add or remove. */
export const MAX_RECEIPTS_PER_CALL = 100;
export const GROUP_NAME_MAX = 60;

export type ReceiptGroup = {
  id: string;
  name: string;
  color: GroupColor;
  receiptCount: number;
  createdBy: string | null;
  createdAt: Date;
  /** Whether the caller may rename, recolour or delete it. */
  canManage: boolean;
};

/** A group as shown on a receipt: no counts. */
export type ReceiptGroupRef = Pick<ReceiptGroup, "id" | "name" | "color">;

export type MembershipChange = {
  /** Receipts newly added (or removed). */
  changed: number;
  /** Already in the group (add) or not in it (remove). */
  unchanged: number;
  /** Skipped because they are already in MAX_GROUPS_PER_RECEIPT groups. */
  atLimit: number;
  /** Not receipts of this workspace. */
  notFound: number;
};

const MANAGER_ROLES: ReadonlySet<string> = new Set<WorkspaceRole>(["owner", "admin"]);

/** Creator, owner or admin. Fails closed: no role and no creator means no. */
export const canManageGroup = (scope: ReceiptScope, createdBy: string | null) =>
  (createdBy !== null && createdBy === scope.userId) ||
  (scope.role ?? "").split(",").some((role) => MANAGER_ROLES.has(role.trim()));
