import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  turnstile: { ok: true } as
    { ok: true } | { ok: false; reason: "missing" | "rejected" | "unavailable" },
}));

type Submission = {
  submissionId: string;
  kind: string;
  name: string;
  email: string;
  message: string;
  sender: { userId: string; organizationId: string } | null;
  receiptId: string | null;
};
const submitted = vi.hoisted(() => [] as Submission[]);
const store = vi.hoisted(() => ({
  result: null as unknown,
  fail: false,
}));
const enqueued = vi.hoisted(() => [] as unknown[]);
const allowContactReply = vi.fn<(email: string, ip: string | null) => Promise<boolean>>();
vi.mock("@receipt-ocr/core", () => ({
  hitRateLimit: () => ({ limit: true }),
  enqueueContactReply: (payload: unknown) => ({ enqueue: payload }),
  submitSupportMessage: (input: Submission) => ({ submit: input }),
}));
vi.mock("@/lib/runtime", () => ({
  runtime: {
    runPromise: async (effect: { enqueue?: unknown; submit?: Submission }) => {
      if (effect.enqueue) enqueued.push(effect.enqueue);
      if (effect.submit) {
        if (store.fail) throw new Error("db down");
        submitted.push(effect.submit);
        return (
          store.result ?? {
            kind: "stored",
            id: "m1",
            source: effect.submit.sender ? "help" : "public",
            receiptId: null,
          }
        );
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  },
}));
vi.mock("@/lib/email-limits", () => ({ allowContactReply }));
const RECEIPT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SUBMISSION = "6f1c2b9e-1d1a-4c7e-9a43-1b2f0a7c5d10";
const sender = vi.hoisted(() => ({
  current: null as { userId: string; organizationId: string } | null,
}));
vi.mock("@/lib/support-sender", () => ({ supportSender: async () => sender.current }));
const specs = vi.hoisted(() => [] as unknown[]);
const events = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/http", () => ({
  clientIp: () => "1.1.1.1",
  crossOriginResponse: () => null,
  jsonError: (status: number, error: string) => Response.json({ error }, { status }),
  withRequestEvent: (
    spec: unknown,
    handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown,
  ) => {
    specs.push(spec);
    return (request: Request, context?: unknown) => {
      const event: Record<string, unknown> = { event: "test" };
      events.push(event);
      return handler(request, context, event);
    };
  },
}));
vi.mock("@/lib/turnstile", () => ({ checkTurnstile: async () => env.turnstile }));
vi.mock("@/lib/log", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  errorFields: () => ({ type: "Error" }),
}));

const { POST } = await import("@/app/api/contact/route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/contact", { method: "POST", body: JSON.stringify(body) }));
const valid = {
  name: "Ada Lovelace",
  email: "me@example.com",
  message: "Hello there, a question",
  topic: "feature",
  submissionId: SUBMISSION,
};
const lastEvent = () => events.at(-1) ?? {};

beforeEach(() => {
  submitted.length = 0;
  enqueued.length = 0;
  events.length = 0;
  store.result = null;
  store.fail = false;
  sender.current = null;
  allowContactReply.mockReset();
  allowContactReply.mockResolvedValue(true);
  env.turnstile = { ok: true };
});

describe("POST /api/contact", () => {
  it.each([
    ["missing", 400],
    ["rejected", 403],
    ["unavailable", 503],
  ] as const)("stores nothing when the Turnstile check is %s", async (reason, status) => {
    env.turnstile = { ok: false, reason };
    const res = await post(valid);
    expect(res.status).toBe(status);
    expect(submitted).toEqual([]);
    expect(allowContactReply).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
  });

  it("refuses an oversized body with 413 before parsing it, declared or streamed", async () => {
    const big = JSON.stringify({ ...valid, message: "x".repeat(70 * 1024) });
    const declared = await POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        body: big,
        headers: { "content-length": String(big.length) },
      }),
    );
    expect(declared.status).toBe(413);
    const streamed = await POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(big));
            controller.close();
          },
        }),
        // @ts-expect-error duplex is required for stream bodies in Node.
        duplex: "half",
      }),
    );
    expect(streamed.status).toBe(413);
    expect(submitted).toEqual([]);
  });

  it("rejects a body that is not a JSON object", async () => {
    expect((await post(["x"])).status).toBe(400);
  });

  it("keeps every rate-limited submission in the logs (abuse signal, never sampled)", () => {
    expect(specs).toEqual([expect.objectContaining({ keepRateLimited: true })]);
  });

  it("stores a visitor's message with its kind and submission id, unlinked", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(submitted).toEqual([
      {
        submissionId: SUBMISSION,
        kind: "feedback",
        name: "Ada Lovelace",
        email: "me@example.com",
        message: "Hello there, a question",
        sender: null,
        receiptId: null,
      },
    ]);
    expect(lastEvent()).toMatchObject({
      outcome: "success",
      kind: "feedback",
      support_source: "public",
    });
  });

  it("gives a submission without a usable id a fresh one", async () => {
    await post({ ...valid, submissionId: "not-a-uuid" });
    await post({ ...valid, submissionId: undefined });
    const [a, b] = submitted.map((s) => s.submissionId);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("links a signed-in sender and passes a problem report's receipt for checking", async () => {
    sender.current = { userId: "u1", organizationId: "o1" };
    store.result = { kind: "stored", id: "m1", source: "receipt", receiptId: RECEIPT };
    expect((await post({ ...valid, topic: "problem", receiptId: RECEIPT })).status).toBe(200);
    expect(submitted[0]).toMatchObject({
      kind: "problem",
      sender: { userId: "u1", organizationId: "o1" },
      receiptId: RECEIPT,
    });
    expect(lastEvent()).toMatchObject({ has_receipt: true, receipt_id: RECEIPT });
  });

  it("ignores a receipt sent with another topic", async () => {
    sender.current = { userId: "u1", organizationId: "o1" };
    await post({ ...valid, topic: "feature", receiptId: RECEIPT });
    expect(submitted[0]?.receiptId).toBeNull();
  });

  it("answers a retried submission with 200 and queues no second auto-reply", async () => {
    store.result = { kind: "duplicate" };
    expect((await post(valid)).status).toBe(200);
    expect(enqueued).toEqual([]);
    expect(lastEvent()).toMatchObject({ outcome: "duplicate" });
  });

  it("refuses a signed-in sender over the daily cap with 429", async () => {
    sender.current = { userId: "u1", organizationId: "o1" };
    store.result = { kind: "rate-limited" };
    const res = await post(valid);
    expect(res.status).toBe(429);
    expect(enqueued).toEqual([]);
  });

  it("asks for a retry when the message can't be stored", async () => {
    store.fail = true;
    const res = await post(valid);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/couldn't save/);
    expect(enqueued).toEqual([]);
  });

  it.each([
    ["missing", { name: undefined }],
    ["blank", { name: " \n\t " }],
    ["too long", { name: "x".repeat(81) }],
  ])("rejects a %s name and stores nothing", async (_label, override) => {
    const res = await post({ ...valid, ...override });
    expect(res.status).toBe(400);
    expect(submitted).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it.each([
    ["an invalid email", { email: "nope" }],
    ["an over-long email", { email: `${"a".repeat(320)}@example.com` }],
    ["a display-name address", { email: "a<x@example.com>" }],
    ["a quoted address", { email: '"x"@example.com' }],
    ["an address with a query", { email: "x@example.com?cc=y" }],
    ["a message under five characters", { message: "😀😀😀" }],
  ])("rejects %s and stores nothing", async (_label, override) => {
    expect((await post({ ...valid, ...override })).status).toBe(400);
    expect(submitted).toEqual([]);
  });

  it("stores the address lowercased", async () => {
    await post({ ...valid, email: "Me@Example.COM" });
    expect(submitted[0]?.email).toBe("me@example.com");
  });

  it("queues an auto-reply with the cleaned first name and no message text", async () => {
    expect((await post({ ...valid, name: "Ada\u0007 Lovelace" })).status).toBe(200);
    expect(allowContactReply).toHaveBeenCalledWith("me@example.com", "1.1.1.1");
    expect(enqueued).toEqual([{ to: "me@example.com", name: "Ada", topic: "feature" }]);
  });

  it("greets a link-like name as 'there'", async () => {
    await post({ ...valid, name: "https://evil.example/win" });
    expect(enqueued).toEqual([expect.objectContaining({ name: "there" })]);
  });

  it("still accepts the message when the auto-reply is over its cap, without queueing one", async () => {
    allowContactReply.mockResolvedValue(false);
    expect((await post(valid)).status).toBe(200);
    expect(submitted).toHaveLength(1);
    expect(enqueued).toEqual([]);
  });

  it("drops honeypot submissions without storing", async () => {
    const res = await post({ ...valid, company: "Acme" });
    expect(res.status).toBe(200);
    expect(submitted).toEqual([]);
    expect(enqueued).toEqual([]);
  });
});
