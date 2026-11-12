import { describe, expect, it, vi } from "vitest";

const runRoute = vi.fn();
const after = vi.hoisted(() => vi.fn((task: () => unknown) => void task()));
const kickJob = vi.hoisted(() => vi.fn());

vi.mock("@receipt-ocr/ai/categories", () => ({ parseCategory: (value: string) => value }));
vi.mock("@receipt-ocr/core", () => ({
  deleteReceipt: vi.fn(),
  JobQueue: {},
  ReceiptRepo: {},
}));
vi.mock("next/server", () => ({
  after,
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));
vi.mock("@/lib/jobs", () => ({ kickJob }));
vi.mock("@/lib/session", () => ({
  getActiveScope: async () => ({ userId: "u1", organizationId: "o1", role: "owner" }),
}));
vi.mock("@/lib/http", () => ({
  annotateCaller: vi.fn(),
  crossOriginResponse: () => null,
  jsonError: (status: number, error: string) => Response.json({ error }, { status }),
  runRoute,
  withRequestEvent:
    (_spec: unknown, handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown) =>
    (request: Request, context?: unknown) =>
      handler(request, context, { event: "test" }),
}));

const { DELETE, PATCH } = await import("./route");

const patch = (body: BodyInit, headers?: HeadersInit) =>
  PATCH(new Request("http://localhost/api/receipts/r1", { method: "PATCH", body, headers }), {
    params: Promise.resolve({ id: "r1" }),
  });

describe("PATCH /api/receipts/[id] body", () => {
  it("refuses a body over 64 KB with 413 before reading it all", async () => {
    const big = JSON.stringify({ merchant: "x".repeat(70 * 1024) });
    const res = await patch(big, { "content-length": String(big.length) });
    expect(res.status).toBe(413);
    expect(runRoute).not.toHaveBeenCalled();
  });

  it("rejects malformed and non-object JSON with 400", async () => {
    expect((await patch("{nope")).status).toBe(400);
    expect((await patch("[1]")).status).toBe(400);
  });

  it("accepts reviewed only as a boolean, sent on its own", async () => {
    expect((await patch(JSON.stringify({ reviewed: "yes" }))).status).toBe(400);
    expect((await patch(JSON.stringify({ reviewed: true, merchant: "x" }))).status).toBe(400);
    expect(runRoute).not.toHaveBeenCalled();
  });

  it("maps a review the repository refuses to 404", async () => {
    runRoute.mockImplementationOnce(
      async (_effect: unknown, onSuccess: (updated: boolean) => Response) => onSuccess(false),
    );
    expect((await patch(JSON.stringify({ reviewed: false }))).status).toBe(404);
    expect(runRoute).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/receipts/[id]", () => {
  const remove = () =>
    DELETE(new Request("http://localhost/api/receipts/r1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "r1" }),
    });

  it("starts the job that deletes the stored file after the response", async () => {
    runRoute.mockImplementationOnce(
      async (_effect: unknown, onSuccess: (result: { jobId: string | null }) => Response) =>
        onSuccess({ jobId: "job-1" }),
    );
    expect((await remove()).status).toBe(200);
    expect(after).toHaveBeenCalledOnce();
    expect(kickJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ trigger: "delete" }));
  });

  it("starts nothing when the receipt had no stored file", async () => {
    after.mockClear();
    kickJob.mockClear();
    runRoute.mockImplementationOnce(
      async (_effect: unknown, onSuccess: (result: { jobId: string | null }) => Response) =>
        onSuccess({ jobId: null }),
    );
    expect((await remove()).status).toBe(200);
    expect(after).not.toHaveBeenCalled();
    expect(kickJob).not.toHaveBeenCalled();
  });
});
