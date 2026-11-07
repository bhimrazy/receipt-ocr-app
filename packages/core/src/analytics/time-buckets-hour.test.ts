import { sql } from "@receipt-ocr/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { bucketSql, bucketsBetween, localHour } from "./time-buckets";

describe("hour buckets", () => {
  it("lists every UTC hour, inclusive, keyed YYYY-MM-DDTHH", () => {
    expect(
      bucketsBetween(new Date("2026-12-31T22:10:00Z"), new Date("2027-01-01T01:00:00Z"), "hour"),
    ).toEqual(["2026-12-31T22", "2026-12-31T23", "2027-01-01T00", "2027-01-01T01"]);
  });

  it("reads hours in the given zone", () => {
    expect(localHour(new Date("2026-12-31T23:30:00Z"), "Asia/Kathmandu")).toBe("2027-01-01T05");
  });

  it("keeps each local hour once across a DST change", () => {
    // Berlin falls back at 01:00 UTC on 25 Oct 2026: local 02:xx happens twice.
    const keys = bucketsBetween(
      new Date("2026-10-24T23:00:00Z"),
      new Date("2026-10-25T02:00:00Z"),
      "hour",
      "Europe/Berlin",
    );
    expect(keys).toEqual(["2026-10-25T01", "2026-10-25T02", "2026-10-25T03"]);
  });

  it("refuses date strings", () => {
    expect(() => bucketsBetween("2026-01-01", "2026-01-02", "hour")).toThrow(TypeError);
  });

  it("renders an hour key in SQL", () => {
    const query = new PgDialect().sqlToQuery(bucketSql(sql`created_at`, "hour", "UTC"));
    expect(query.sql).toBe(
      `to_char(date_trunc('hour', (created_at at time zone $1)), 'YYYY-MM-DD"T"HH24')`,
    );
  });
});
