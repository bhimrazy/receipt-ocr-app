import { formatStorage } from "@receipt-ocr/core/plans";
import { NEAR_RATIO } from "./upgrade-level";

export type StorageUsage = { usedBytes: number; limitBytes: number };

export const storageRatio = ({ usedBytes, limitBytes }: StorageUsage) =>
  limitBytes > 0 ? Math.min(1, usedBytes / limitBytes) : 0;

export const storageIsFull = ({ usedBytes, limitBytes }: StorageUsage) => usedBytes >= limitBytes;

/** The card, the phone strip and the upload panel show storage from NEAR_RATIO. */
export const storageShows = (storage: StorageUsage | undefined): storage is StorageUsage =>
  storage !== undefined && storageRatio(storage) >= NEAR_RATIO;

/**
 * How to make room: owners and admins may delete any receipt, a member only their own, so a
 * member is sent to the owner.
 */
const makeRoom = (manages: boolean) =>
  manages ? "Delete receipts to make room." : "Ask the owner to make room.";

/** "86 MB / 100 MB": used rounded down, so it never reads as full before it is. */
const storageCount = ({ usedBytes, limitBytes }: StorageUsage) =>
  `${formatStorage(usedBytes)} / ${formatStorage(limitBytes)}`;

/**
 * The storage row's sentence. Billing (`detail`) always says how much is used, and how to make
 * room from NEAR_RATIO; the card says it only when full. No reset wording: storage never resets.
 */
export function storageNote(
  storage: StorageUsage,
  manages: boolean,
  detail: boolean,
): string | null {
  const limit = formatStorage(storage.limitBytes);
  if (storageIsFull(storage))
    return `This workspace's ${limit} of storage is full. ${makeRoom(manages)}`;
  if (!detail) return null;
  const used = `${formatStorage(storage.usedBytes)} of ${limit} used.`;
  return storageRatio(storage) >= NEAR_RATIO ? `${used} ${makeRoom(manages)}` : used;
}

/** The phone strip's storage line from NEAR_RATIO; null below it. */
export function storageStripNote(storage: StorageUsage | undefined): string | null {
  if (!storageShows(storage)) return null;
  return storageIsFull(storage)
    ? `Storage full · ${formatStorage(storage.limitBytes)}`
    : `Storage ${storageCount(storage)}`;
}
