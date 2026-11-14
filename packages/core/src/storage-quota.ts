import { sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import { QuotaExceeded } from "./errors";
import { formatStorage } from "./plans";
import type { Queryable } from "./usage";

/**
 * Bytes of stored files a workspace holds now: the exact sum of `receipts.file_bytes`. Unlike scans
 * it counts what is kept, so deleting receipts makes room. A receipt whose size isn't known yet
 * (stored before sizes were recorded, until `receipt.file_size_backfill` reads it) counts as 0.
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
  limitBytes: number;
};

/** Whether a file of `fileBytes` fits: the cap is never passed, so a full workspace takes nothing more. */
export const decideStorage = (
  usedBytes: number,
  fileBytes: number,
  limitBytes: number,
): StorageVerdict => ({ allowed: usedBytes + fileBytes <= limitBytes, usedBytes, limitBytes });

/**
 * What a refused upload is told. Like `quotaMessage`, never "upgrade": the text is shown without a
 * control, and deleting receipts is what always works.
 */
export function storageMessage({ usedBytes, limitBytes }: StorageVerdict): string {
  const limit = formatStorage(limitBytes);
  if (usedBytes >= limitBytes) {
    return `This workspace's storage is full: ${limit} used. Delete receipts to make room.`;
  }
  return `This file doesn't fit in this workspace's storage: ${formatStorage(usedBytes)} of ${limit} used. Delete receipts to make room.`;
}

/**
 * No `retryAfterSeconds`: waiting frees nothing, so the response has no `Retry-After` and a batch
 * stops instead of pausing.
 */
export const refuseStorage = (verdict: StorageVerdict) =>
  Effect.fail(new QuotaExceeded({ message: storageMessage(verdict), kind: "storage" }));
