import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { receiptsToCsv } from "@/lib/csv";
import { sampleExportRows } from "./sample-export";

describe("sample export", () => {
  it("public/sample-receipts.csv matches the rows the Export section shows", () => {
    const file = path.join(import.meta.dirname, "../../../../public/sample-receipts.csv");
    expect(readFileSync(file, "utf8")).toBe(receiptsToCsv(sampleExportRows));
  });

  it("every sample row adds up", () => {
    for (const row of sampleExportRows) {
      const parts = [row.subtotal, row.tax, row.tip].reduce((sum, v) => sum + Number(v ?? 0), 0);
      expect(parts.toFixed(2)).toBe(row.total);
    }
  });
});
