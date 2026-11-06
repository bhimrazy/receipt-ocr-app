import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = { organizationId: "org-1", userId: "user-1", role: "owner" };
const state = vi.hoisted(() => ({ scope: null as unknown }));
const counts = vi.fn();
const counts_ = { total: 4, needsReview: 1, failed: 0, inFlight: 2 };

vi.mock("@/lib/session", () => ({ getActiveScope: async () => state.scope }));
vi.mock("@receipt-ocr/core", async () => {
  const { Context } = await import("effect");
  return { ReceiptRepo: Context.GenericTag("ReceiptRepo") };
});
vi.mock("@/lib/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    jsonError: (status: number, error: string) => NextResponse.json({ error }, { status }),
    runRoute: async (
      program: import("effect").Effect.Effect<unknown, never, never>,
      ok: (value: never) => Response,
    ) => {
      const { Effect } = await import("effect");
      const { ReceiptRepo } = await import("@receipt-ocr/core");
      const value = await Effect.runPromise(
        Effect.provideService(program as never, ReceiptRepo as never, { counts } as never),
      );
      return ok(value as never);
    },
  };
});

const { GET } = await import("./route");

beforeEach(() => {
  counts.mockReset();
  state.scope = scope;
});

describe("GET /api/receipts/status", () => {
  it("is 401 without a workspace scope", async () => {
    state.scope = null;
    expect((await GET()).status).toBe(401);
    expect(counts).not.toHaveBeenCalled();
  });

  it("returns the counts for the caller's scope, uncached", async () => {
    const { Effect } = await import("effect");
    counts.mockReturnValue(Effect.succeed(counts_));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(counts_);
    expect(counts).toHaveBeenCalledWith(scope);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
