import * as schema from "@receipt-ocr/db";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";

// Guard for new tables: every pgTable must call `.enableRLS()` so the generated
// migration enables row-level security (see docs/architecture/db.md).
describe("schema row-level security", () => {
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];

  it("finds the tables", () => {
    expect(tables.length).toBeGreaterThanOrEqual(19);
  });

  it("calls .enableRLS() on every table", () => {
    const missing = tables.map(getTableConfig).filter((t) => !t.enableRLS);
    expect(missing.map((t) => t.name)).toEqual([]);
  });
});
