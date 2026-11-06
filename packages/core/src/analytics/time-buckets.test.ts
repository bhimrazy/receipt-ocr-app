import { describe, expect, it } from "vitest";
import { shiftMonths } from "./dates";
import { bucketOf, bucketsBetween, fillBuckets, isTimeZone, localDate } from "./time-buckets";

describe("bucketsBetween", () => {
  it("lists every day, inclusive", () => {
    expect(bucketsBetween("2026-02-27", "2026-03-02", "day")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("starts weeks on Monday, including a partial first week", () => {
    // 2026-11-04 is a Wednesday.
    expect(bucketsBetween("2026-11-04", "2026-11-17", "week")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
  });

  it("crosses a year in months", () => {
    expect(bucketsBetween("2025-11-30", "2026-02-01", "month")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("reads instants as days in the given zone", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Kathmandu (UTC+5:45).
    const at = new Date("2026-12-31T23:30:00Z");
    expect(bucketsBetween(at, at, "day")).toEqual(["2026-12-31"]);
    expect(bucketsBetween(at, at, "day", "Asia/Kathmandu")).toEqual(["2027-01-01"]);
    expect(localDate(at, "America/Los_Angeles")).toBe("2026-12-31");
  });

  it("is empty when the range is reversed", () => {
    expect(bucketsBetween("2026-03-02", "2026-03-01", "day")).toEqual([]);
  });
});

describe("fillBuckets", () => {
  it("keeps order and fills gaps with the empty value", () => {
    const filled = fillBuckets(
      ["2026-01-01", "2026-02-01", "2026-03-01"],
      [
        { bucket: "2026-03-01", value: 5 },
        { bucket: "2025-12-01", value: 9 },
      ],
      0,
    );
    expect(filled).toEqual([
      { bucket: "2026-01-01", value: 0 },
      { bucket: "2026-02-01", value: 0 },
      { bucket: "2026-03-01", value: 5 },
    ]);
  });
});

describe("bucket helpers", () => {
  it("maps a Sunday to the Monday before it", () => {
    expect(bucketOf("2026-11-08", "week")).toBe("2026-11-02");
  });

  it("clamps the day when shifting months", () => {
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonths("2024-02-29", -12)).toBe("2023-02-28");
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("knows real zones from made-up ones", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});
