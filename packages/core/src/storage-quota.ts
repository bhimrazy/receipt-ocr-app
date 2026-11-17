import { sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import { QuotaExceeded } from "./errors";
import { formatStorage } from "./plans";
import type { Queryable } from "./usage";

/**
 * Bytes of stored files a workspace holds now: the exact sum of `receipts.file_bytes`. Unlike scans
 * it counts what is kept, so deleting receipts makes room. A receipt whose size isn't known yet
 * (stored by an older release, until `receipt.file_size_backfill` reads it) counts as 0.
 */
export async function sumStorage(db: Queryable, organizationId: string): Promise<number> {
  const { rows } = await db.execute<{ used: string | number }>(
    sql`select coalesce(sum(file_bytes), 0)::bigint as used from receipts where organization_id = ${organizationId}`,
  );
  return Number(rows[0]?.used ?? 0);
}

export type StorageVerdict = {
  allowed: boolean;
  usedBytes: number;
  fileBytes: number;
  limitBytes: number;
};

/** Whether a file of `fileBytes` fits: the cap is never passed, so a full workspace takes nothing more. */
export const decideStorage = (
  usedBytes: number,
  fileBytes: number,
  limitBytes: number,
): StorageVerdict => ({
  allowed: usedBytes + fileBytes <= limitBytes,
  usedBytes,
  fileBytes,
  limitBytes,
});

const storageFull = ({ usedBytes, limitBytes }: Pick<StorageVerdict, "usedBytes" | "limitBytes">) =>
  usedBytes >= limitBytes;

/**
 * What a refused upload is told. Like `quotaMessage`, never "upgrade": the text is shown without a
 * control. `manages`: the viewer may delete any receipt in the workspace (owner or admin); a member
 * may delete only their own, so they are sent to the owner instead.
 */
export function storageMessage(verdict: StorageVerdict, manages: boolean): string {
  const limit = formatStorage(verdict.limitBytes);
  const action = manages ? "Delete receipts to make room." : "Ask the owner to make room.";
  if (storageFull(verdict)) return `This workspace's ${limit} of storage is full. ${action}`;
  const file = formatStorage(verdict.fileBytes, "up");
  const left = formatStorage(verdict.limitBytes - verdict.usedBytes);
  return `This file (${file}) doesn't fit: this workspace has ${left} of its ${limit} storage left. ${action}`;
}

/**
 * No `retryAfterSeconds`: waiting frees nothing, so the response has no `Retry-After`. `full` tells
 * a batch to stop; a file that only doesn't fit is skipped and the rest go on.
 */
export const refuseStorage = (verdict: StorageVerdict, manages: boolean) =>
  Effect.fail(
    new QuotaExceeded({
      message: storageMessage(verdict, manages),
      kind: "storage",
      storageFull: storageFull(verdict),
    }),
  );
