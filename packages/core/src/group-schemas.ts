/** Input schemas for receipt groups. Server only: zod must not reach client bundles. */
import { z } from "zod";
import { GROUP_COLORS, GROUP_NAME_MAX, MAX_RECEIPTS_PER_CALL } from "./group-rules";

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
