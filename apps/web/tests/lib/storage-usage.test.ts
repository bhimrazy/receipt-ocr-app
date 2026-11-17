import { MB } from "@receipt-ocr/core/plans";
import { describe, expect, it } from "vitest";
import { storageNote, storageShows, storageStripNote } from "@/lib/storage-usage";

const at = (usedBytes: number) => ({ usedBytes, limitBytes: 100 * MB });

describe("storage words", () => {
  it("shows on the card and strip from 80%", () => {
    expect(storageShows(at(79 * MB))).toBe(false);
    expect(storageShows(at(80 * MB))).toBe(true);
    expect(storageShows(undefined)).toBe(false);
    expect(storageStripNote(at(50 * MB))).toBeNull();
    expect(storageStripNote(at(86.7 * MB))).toBe("Storage 86 MB / 100 MB");
    expect(storageStripNote(at(100 * MB))).toBe("Storage full · 100 MB");
  });

  it("gives Billing the amount always, and how to make room from 80%", () => {
    expect(storageNote(at(12 * MB), true, true)).toBe("12 MB of 100 MB used.");
    expect(storageNote(at(86 * MB), true, true)).toBe(
      "86 MB of 100 MB used. Delete receipts to make room.",
    );
    expect(storageNote(at(86 * MB), false, true)).toBe(
      "86 MB of 100 MB used. Ask the owner to make room.",
    );
  });

  it("gives the card a sentence only when full", () => {
    expect(storageNote(at(86 * MB), true, false)).toBeNull();
    expect(storageNote(at(100 * MB), true, false)).toBe(
      "This workspace's 100 MB of storage is full. Delete receipts to make room.",
    );
  });

  it("never reads as full before it is, and never says it resets", () => {
    expect(storageNote(at(99.99 * MB), true, true)).toBe(
      "99 MB of 100 MB used. Delete receipts to make room.",
    );
    for (const used of [10, 85, 99.99, 100]) {
      for (const detail of [true, false]) {
        expect(storageNote(at(used * MB), true, detail) ?? "").not.toMatch(/reset/i);
      }
      expect(storageStripNote(at(used * MB)) ?? "").not.toMatch(/reset/i);
    }
  });
});
