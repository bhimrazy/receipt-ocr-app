import { beforeEach, describe, expect, it, vi } from "vitest";

const runPromise = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("@receipt-ocr/core", () => ({ checkReadiness: "checkReadiness" }));
vi.mock("@/lib/runtime", () => ({ runtime: { runPromise } }));
vi.mock("@/lib/log", () => ({ logger }));
vi.mock("@/lib/http", () => ({
  withRequestEvent:
    (_spec: unknown, handler: (r: Request, c: unknown, e: Record<string, unknown>) => unknown) =>
    (request: Request, context?: unknown) =>
      handler(request, context, { event: "test" }),
}));

const live = await import("./route");
const ready = await import("./ready/route");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  runPromise.mockReset();
  logger.error.mockReset();
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
});

describe("GET /api/health", () => {
  it("answers ok with only the short commit, without touching dependencies", async () => {
    const res = await live.GET(new Request("https://app.example/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=10");
    expect(await res.json()).toEqual({ ok: true, commit: "0123456" });
    expect(runPromise).not.toHaveBeenCalled();
  });
});

describe("GET /api/health/ready", () => {
  it("is 200 when the checks pass", async () => {
    vi.setSystemTime(new Date("2026-11-06T01:00:00Z"));
    runPromise.mockResolvedValue({ ok: true, checks: { database: "ok", storage: "ok" } });
    const res = await ready.GET(new Request("https://app.example/api/health/ready"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=10");
    expect(await res.json()).toEqual({
      ok: true,
      checks: { database: "ok", storage: "ok" },
      commit: "0123456",
    });
  });

  it("is 503 when the runtime can't build, and logs once per fresh check", async () => {
    vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
    runPromise.mockRejectedValue(new Error("DATABASE_URL is not configured"));
    const res = await ready.GET(new Request("https://app.example/api/health/ready"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.checks.database).toBe("down");
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    await ready.GET(new Request("https://app.example/api/health/ready"));
    expect(runPromise).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("checks again once the 5 s cache expires", async () => {
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));
    runPromise.mockResolvedValue({ ok: true, checks: { database: "ok", storage: "ok" } });
    await ready.GET(new Request("https://app.example/api/health/ready"));
    vi.setSystemTime(new Date("2026-11-06T03:00:06Z"));
    await ready.GET(new Request("https://app.example/api/health/ready"));
    expect(runPromise).toHaveBeenCalledTimes(2);
  });
});
