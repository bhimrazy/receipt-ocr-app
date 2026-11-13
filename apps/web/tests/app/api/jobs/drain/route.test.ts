import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "drain-secret-".repeat(4);
const state = vi.hoisted(() => ({ secret: undefined as string | undefined }));
const drainQueue = vi.fn();
const runPromise = vi.fn();
const events: Record<string, unknown>[] = [];

vi.mock("@/lib/env", () => ({ cronSecret: () => state.secret }));
vi.mock("@/lib/jobs", () => ({ drainQueue }));
vi.mock("@/lib/runtime", () => ({ runtime: { runPromise } }));
vi.mock("@/lib/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    jsonError: (status: number, error: string, headers?: HeadersInit) =>
      NextResponse.json({ error }, { status, headers }),
    withRequestEvent:
      (_spec: unknown, handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown) =>
      (request: Request, context?: unknown) => {
        const event: Record<string, unknown> = { event: "test", request_id: "req-1" };
        events.push(event);
        return handler(request, context, event);
      },
  };
});

const { GET, POST, maxDuration, dynamic } = await import("@/app/api/jobs/drain/route");

const summary = {
  claimed: 2,
  succeeded: 2,
  retried: 0,
  deferred: 0,
  dead: 0,
  lost: 0,
  reaped: 1,
  capped: false,
  ms: 1200,
};
const call = (method: typeof GET, authorization?: string) =>
  method(
    new Request("https://app.example/api/jobs/drain", {
      method: method === GET ? "GET" : "POST",
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  state.secret = SECRET;
  events.length = 0;
  drainQueue.mockReset().mockReturnValue("program");
  runPromise.mockReset().mockResolvedValue(summary);
});

describe("/api/jobs/drain", () => {
  it("is dynamic and fits Hobby's 60 s", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ])("%s drains once with the right secret and returns counts, uncached", async (_name, method) => {
    const res = await call(method, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(drainQueue).toHaveBeenCalledWith({ request_id: "req-1" });
    expect(runPromise).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({ count: 2, outcome: "ran" });
  });

  it("is 401 without a header or with a wrong secret, and runs nothing", async () => {
    for (const header of [undefined, "Bearer wrong", `Bearer ${SECRET}x`]) {
      const res = await call(GET, header);
      expect(res.status).toBe(401);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    expect((await call(POST, "Bearer wrong")).status).toBe(401);
    expect(runPromise).not.toHaveBeenCalled();
    // No notice: a notice would exempt these events from sampling, a free log flood.
    expect(events[0]!.notices).toBeUndefined();
    expect(events[0]!.outcome).toBe("unauthorized");
  });

  it("is 401 when CRON_SECRET is unset, whatever the caller sends", async () => {
    state.secret = undefined;
    expect((await call(GET, `Bearer ${SECRET}`)).status).toBe(401);
    expect((await call(POST)).status).toBe(401);
    expect(runPromise).not.toHaveBeenCalled();
    expect(events[0]!.notices).toEqual(["jobs.drain_unconfigured"]);
  });

  it("reports an idle pass", async () => {
    runPromise.mockResolvedValue({ ...summary, claimed: 0, succeeded: 0, reaped: 0 });
    await call(GET, `Bearer ${SECRET}`);
    expect(events[0]).toMatchObject({ count: 0, outcome: "idle" });
  });
});
