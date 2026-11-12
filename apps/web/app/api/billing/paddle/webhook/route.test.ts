import { describe, expect, it, vi } from "vitest";

const runRoute = vi.fn(async () => Response.json({ ok: true }));
const receiveWebhook = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/core", () => ({ Billing: {} }));
vi.mock("effect", () => ({
  Effect: { flatMap: (_tag: unknown, f: (b: unknown) => unknown) => f({ receiveWebhook }) },
}));
vi.mock("next/server", () => ({ after: vi.fn(), NextResponse: { json: Response.json } }));
vi.mock("@/lib/jobs", () => ({ kickJob: vi.fn() }));
vi.mock("@/lib/http", () => ({
  jsonError: (status: number, error: string) => Response.json({ error }, { status }),
  runRoute,
  withRequestEvent:
    (_spec: unknown, handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown) =>
    (request: Request) =>
      handler(request, undefined, { event: "test" }),
}));

const { POST } = await import("./route");

/** A chunked body with no Content-Length, counting how much of it was pulled. */
function stream(chunks: number) {
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  const state = { pulls: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(chunk);
      if (state.pulls >= chunks) controller.close();
    },
  });
  const request = new Request("http://localhost/api/billing/paddle/webhook", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  return { request, state };
}

describe("POST /api/billing/paddle/webhook body", () => {
  it("stops reading a chunked body once it passes 256 KB, before checking the signature", async () => {
    const { request, state } = stream(1000);
    const res = await POST(request);
    expect(res.status).toBe(413);
    expect(state.pulls).toBeLessThan(10);
    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it("hands a body within the limit, as text, to the signature check", async () => {
    const body = '{"event_id":"evt_test"}';
    const res = await POST(
      new Request("http://localhost/api/billing/paddle/webhook", {
        method: "POST",
        body,
        headers: { "paddle-signature": "ts=1;h1=abc" },
      }),
    );
    expect(res.status).toBe(200);
    expect(receiveWebhook).toHaveBeenCalledWith(body, "ts=1;h1=abc");
  });
});
