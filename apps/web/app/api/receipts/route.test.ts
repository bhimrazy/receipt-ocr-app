import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string }; session: Record<string, unknown> },
  scope: null as null | { organizationId: string; userId: string; role: string },
}));
const readFormData = vi.fn();

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@receipt-ocr/core", () => ({ MAX_UPLOAD_BYTES: 10 * 1024 * 1024 }));
vi.mock("@/lib/jobs", () => ({ drainJobs: vi.fn(), ROUTE_BUDGET_MS: 1, runJobNow: vi.fn() }));
vi.mock("@/lib/quota", () => ({ enforceUploadQuota: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/session", () => ({
  getSession: async () => state.session,
  getActiveScope: async () => state.scope,
}));
vi.mock("@/lib/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    crossOriginResponse: () => null,
    discardBody: (request: Request, response: Response) => {
      void request.body?.cancel();
      return response;
    },
    jsonError: (status: number, error: string) => NextResponse.json({ error }, { status }),
    readFormData,
    runRoute: vi.fn(),
    annotateCaller: vi.fn(),
    withRequestEvent:
      (_spec: unknown, handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown) =>
      (request: Request, context?: unknown) =>
        handler(request, context, { event: "test" }),
  };
});

const { POST } = await import("./route");

/** A request whose body records whether anything pulled from it, and whether it was cancelled. */
function upload() {
  const body = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      body.pulls++;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      body.cancelled = true;
    },
  });
  const request = new Request("https://app.example/api/receipts", {
    method: "POST",
    body: stream,
    // @ts-expect-error Node's fetch needs this for a streamed body.
    duplex: "half",
  });
  return { request, body };
}

beforeEach(() => {
  readFormData.mockReset();
  state.session = null;
  state.scope = null;
});

describe("POST /api/receipts before the body is read (audit L1)", () => {
  it("rejects a signed-out upload without reading the body, and cancels it", async () => {
    const { request, body } = upload();
    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(readFormData).not.toHaveBeenCalled();
    expect(body.cancelled).toBe(true);
  });

  it("rejects an upload with no workspace without reading the body", async () => {
    state.session = { user: { id: "u1" }, session: {} };
    const { request, body } = upload();
    const res = await POST(request);
    expect(res.status).toBe(409);
    expect(readFormData).not.toHaveBeenCalled();
    expect(body.cancelled).toBe(true);
  });

  it("reads the body once the session and workspace are known", async () => {
    state.session = { user: { id: "u1" }, session: {} };
    state.scope = { organizationId: "o1", userId: "u1", role: "owner" };
    readFormData.mockResolvedValue(new Response(null, { status: 413 }));
    const { request } = upload();
    const res = await POST(request);
    expect(readFormData).toHaveBeenCalledOnce();
    expect(res.status).toBe(413);
  });
});
