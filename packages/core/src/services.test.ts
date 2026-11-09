import { describe, expect, it, vi } from "vitest";
import { logPoolEvent } from "./services";

describe("logPoolEvent", () => {
  it("writes db.query_timeout with the db group and nothing dropped", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logPoolEvent({
      type: "query_timeout",
      phase: "query",
      query: { operation: "select", table: "receipts", statementHash: "0a1b2c3d" },
      timeoutMs: 15_000,
      inFlight: 10,
      queued: 4,
    });
    const line = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
    error.mockRestore();
    expect(line).toMatchObject({
      event: "db.query_timeout",
      level: "error",
      unit: "log",
      db: {
        operation: "select",
        table: "receipts",
        statement_hash: "0a1b2c3d",
        phase: "query",
        timeout_ms: 15_000,
        in_flight: 10,
        queued: 4,
      },
    });
    expect(line).not.toHaveProperty("dropped_fields");
  });
});
