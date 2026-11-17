import { describe, expect, it } from "vitest";
import { formatStorage, MB } from "../src/plans";
import { decideStorage, storageMessage } from "../src/storage-quota";

describe("formatStorage", () => {
  it("shows caps exactly, in decimal units", () => {
    expect(formatStorage(0)).toBe("0 MB");
    expect(formatStorage(100 * MB)).toBe("100 MB");
    expect(formatStorage(1_000 * MB)).toBe("1 GB");
    expect(formatStorage(1_500 * MB)).toBe("1.5 GB");
    expect(formatStorage(5_000 * MB)).toBe("5 GB");
  });

  it("rounds used space down, so it never reads as the cap before it is", () => {
    expect(formatStorage(99.99 * MB)).toBe("99 MB");
    expect(formatStorage(4_960 * MB)).toBe("4.9 GB");
    expect(formatStorage(999.6 * MB)).toBe("999 MB");
    expect(formatStorage(9.99 * MB)).toBe("9.9 MB");
    expect(formatStorage(84_007)).toBe("84 KB");
    expect(formatStorage(412)).toBe("<1 KB");
  });

  it("rounds a file's size up, for the room it needs", () => {
    expect(formatStorage(4 * 1024 * 1024, "up")).toBe("4.2 MB");
    expect(formatStorage(412, "up")).toBe("1 KB");
  });
});

describe("storage cap", () => {
  it("lets a file fill the cap exactly, never past it", () => {
    expect(decideStorage(90 * MB, 10 * MB, 100 * MB).allowed).toBe(true);
    expect(decideStorage(90 * MB, 10 * MB + 1, 100 * MB).allowed).toBe(false);
    expect(decideStorage(100 * MB, 0, 100 * MB).allowed).toBe(true);
  });

  it("says the workspace is full, or the file's size and the room left, and how to make room", () => {
    expect(storageMessage(decideStorage(100 * MB, 1, 100 * MB), true)).toBe(
      "This workspace's 100 MB of storage is full. Delete receipts to make room.",
    );
    expect(storageMessage(decideStorage(99.99 * MB, 4.1 * MB, 100 * MB), true)).toBe(
      "This file (4.1 MB) doesn't fit: this workspace has 10 KB of its 100 MB storage left. Delete receipts to make room.",
    );
    expect(storageMessage(decideStorage(4_900 * MB, 200 * MB, 5_000 * MB), true)).toBe(
      "This file (200 MB) doesn't fit: this workspace has 100 MB of its 5 GB storage left. Delete receipts to make room.",
    );
  });

  it("sends a member, who can delete only their own receipts, to the owner", () => {
    expect(storageMessage(decideStorage(100 * MB, 1, 100 * MB), false)).toBe(
      "This workspace's 100 MB of storage is full. Ask the owner to make room.",
    );
  });

  it("never says storage resets", () => {
    for (const used of [50 * MB, 99 * MB, 100 * MB]) {
      expect(storageMessage(decideStorage(used, 60 * MB, 100 * MB), true)).not.toMatch(/reset/i);
    }
  });
});
