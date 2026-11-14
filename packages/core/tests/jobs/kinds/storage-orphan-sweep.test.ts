import { receiptObjectKey } from "@receipt-ocr/storage";
import { describe, expect, it } from "vitest";
import {
  receiptIdOfKey,
  storageOrphanSweepJob,
} from "../../../src/jobs/kinds/storage-orphan-sweep";

const id = "0b7f3c1e-8a52-4c3f-9d0e-5a1b2c3d4e5f";

describe("receiptIdOfKey", () => {
  it("reads the receipt id from a key receiptObjectKey made", () => {
    expect(receiptIdOfKey(receiptObjectKey("user-1", id, "image/jpeg"))).toBe(id);
    expect(receiptIdOfKey(receiptObjectKey("user-1", id, "application/x-unknown"))).toBe(id);
  });

  it("rejects any other key, so the sweep never deletes it", () => {
    expect(receiptIdOfKey(`users/user-1/receipts/not-a-uuid.jpg`)).toBeUndefined();
    expect(receiptIdOfKey(`users/user-1/exports/${id}.csv`)).toBeUndefined();
    expect(receiptIdOfKey(`users/user-1/receipts/x/${id}.jpg`)).toBeUndefined();
    expect(receiptIdOfKey(`_health/check-${id}`)).toBeUndefined();
  });
});

describe("storageOrphanSweepJob", () => {
  it("keys each part by day and prefix, so a part is queued once while it is live", () => {
    expect(storageOrphanSweepJob({ day: "2026-11-14", part: 0 }).idempotencyKey).toBe(
      "storage.orphan_sweep:2026-11-14::0",
    );
    expect(
      storageOrphanSweepJob({ day: "2026-11-14", part: 3, prefix: "users/u1/", startAfter: "k" })
        .idempotencyKey,
    ).toBe("storage.orphan_sweep:2026-11-14:users/u1/:3");
  });
});
