import { describe, expect, it } from "vitest";
import { formatStorage, MB } from "../src/plans";
import { decideStorage, storageMessage } from "../src/storage-quota";

describe("formatStorage", () => {
  it("shows whole MB under 1 GB and one decimal GB from there, in decimal units", () => {
    expect(formatStorage(0)).toBe("0 MB");
    expect(formatStorage(86.4 * MB)).toBe("86 MB");
    expect(formatStorage(100 * MB)).toBe("100 MB");
    expect(formatStorage(1_000 * MB)).toBe("1 GB");
    expect(formatStorage(4_140 * MB)).toBe("4.1 GB");
    expect(formatStorage(5_000 * MB)).toBe("5 GB");
  });
});

describe("storage cap", () => {
  it("lets a file fill the cap exactly, never past it", () => {
    expect(decideStorage(90 * MB, 10 * MB, 100 * MB).allowed).toBe(true);
    expect(decideStorage(90 * MB, 10 * MB + 1, 100 * MB).allowed).toBe(false);
    expect(decideStorage(100 * MB, 0, 100 * MB).allowed).toBe(true);
  });

  it("says the workspace is full, or that this file doesn't fit, and how to make room", () => {
    expect(storageMessage(decideStorage(100 * MB, 1, 100 * MB))).toBe(
      "This workspace's storage is full: 100 MB used. Delete receipts to make room.",
    );
    expect(storageMessage(decideStorage(4_900 * MB, 200 * MB, 5_000 * MB))).toBe(
      "This file doesn't fit in this workspace's storage: 4.9 GB of 5 GB used. Delete receipts to make room.",
    );
  });
});
