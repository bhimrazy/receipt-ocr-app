/**
 * Receipt group rules shared by the server and the browser: the colour
 * palette, limits, input schemas and result types. No database code here, so
 * client components can import it (`@receipt-ocr/core/group-rules`).
 */
import { z } from "zod";
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

// Control and format characters (bidi overrides, zero-width) would let two names look alike.
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;

export const groupNameSchema = z
  .string({ error: "Enter a group name." })
  .transform((name) => name.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Enter a group name.")
      .max(GROUP_NAME_MAX, `Group names can be up to ${GROUP_NAME_MAX} characters.`)
      .refine((name) => !HIDDEN_CHARS.test(name), "Group names can't contain hidden characters."),
  );

export const groupColorSchema = z.enum(GROUP_COLORS, { error: "Pick a colour from the list." });

export const groupIdSchema = z.uuid({ error: "Group not found" });

export const createGroupSchema = z.strictObject({ name: groupNameSchema, color: groupColorSchema });

export const updateGroupSchema = z
  .strictObject({ name: groupNameSchema.optional(), color: groupColorSchema.optional() })
  .refine((patch) => patch.name !== undefined || patch.color !== undefined, {
    error: "Nothing to change.",
  });

export const receiptIdsSchema = z.strictObject({
  receiptIds: z
    .array(z.uuid({ error: "Receipt ids must be UUIDs." }))
    .min(1, "Choose at least one receipt.")
    .max(MAX_RECEIPTS_PER_CALL, `Up to ${MAX_RECEIPTS_PER_CALL} receipts at a time.`)
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});

export const receiptGroupBodySchema = z.strictObject({ groupId: groupIdSchema });

export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

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
