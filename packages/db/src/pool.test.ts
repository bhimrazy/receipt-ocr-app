import { describe, expect, it } from "vitest";
import { labelQuery } from "./pool";

describe("labelQuery", () => {
  it("names the operation and first table of drizzle's statements", () => {
    expect(
      labelQuery('select "id", "status" from "receipts" where "receipts"."organization_id" = $1'),
    ).toMatchObject({ operation: "select", table: "receipts" });
    expect(labelQuery('insert into "ocr_rounds" ("id") values ($1)')).toMatchObject({
      operation: "insert",
      table: "ocr_rounds",
    });
    expect(labelQuery('update "jobs" set "status" = $1')).toMatchObject({
      operation: "update",
      table: "jobs",
    });
    expect(labelQuery('delete from "public"."receipt_items" where id = $1')).toMatchObject({
      operation: "delete",
      table: "receipt_items",
    });
    expect(labelQuery("with x as (select 1) select * from member")).toMatchObject({
      operation: "select",
      table: "member",
    });
    expect(
      labelQuery(
        'select count(*) filter (where not exists (select 1 from "jobs" j where j.id = $1)) from "receipts" where id = $2',
      ),
    ).toMatchObject({ operation: "select", table: "receipts" });
    expect(labelQuery("select pg_advisory_xact_lock($1, $2)")).toMatchObject({
      operation: "select",
      table: "unknown",
    });
  });

  it("hashes the text so repeats group, and never carries the text itself", () => {
    const a = labelQuery("select * from receipts where id = $1");
    expect(a.statementHash).toMatch(/^[0-9a-f]{8}$/);
    expect(labelQuery("select * from receipts where id = $1").statementHash).toBe(a.statementHash);
    expect(labelQuery("select * from receipts where id = $2").statementHash).not.toBe(
      a.statementHash,
    );
    expect(JSON.stringify(a)).not.toContain("where");
  });
});
