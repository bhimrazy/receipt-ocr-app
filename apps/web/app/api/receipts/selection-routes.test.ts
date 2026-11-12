import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Scope = { organizationId: string; userId: string; role: string; impersonatedBy?: string };
const state = vi.hoisted(() => ({ scope: null as Scope | null }));
const repo = vi.hoisted(() => ({
  removeMany: vi.fn(),
  matchingIds: vi.fn(),
  exportRows: vi.fn(),
}));
const kickJob = vi.hoisted(() => vi.fn());
const after = vi.hoisted(() => vi.fn((task: () => unknown) => void task()));

vi.mock("@/lib/env", () => ({
  authEnv: {
    betterAuthUrl: "https://app.example",
    trustedOrigins: ["https://app.example"],
    ipAddress: {},
  },
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logger: { emit: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// The repository is the only service these routes reach.
vi.mock("@/lib/runtime", async () => {
  const { ReceiptRepo } = await import("@receipt-ocr/core");
  const provide = (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.provideService(effect, ReceiptRepo, repo as never);
  return {
    runtime: {
      runPromiseExit: (effect: Effect.Effect<unknown, unknown, never>) =>
        Effect.runPromiseExit(provide(effect)),
      runPromise: (effect: Effect.Effect<unknown, unknown, never>) =>
        Effect.runPromise(provide(effect)),
    },
  };
});
vi.mock("@/lib/session", () => ({
  getActiveScope: async () => state.scope,
  requireActiveScope: async () => state.scope,
}));
vi.mock("@/lib/jobs", () => ({ kickJob }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after,
}));

const remove = await import("./delete/route");
const ids = await import("./ids/route");
const exporter = await import("./export/route");

const ORIGIN = "https://app.example";
const ORG = "org-1";
const A = "6f1c1d1e-7a3b-4c2d-9e8f-0a1b2c3d4e5f";
const owner: Scope = { organizationId: ORG, userId: "user-1", role: "owner" };

function post(path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  state.scope = owner;
  for (const fn of Object.values(repo)) fn.mockReset();
  kickJob.mockReset();
  after.mockClear();
});

describe("POST /api/receipts/delete", () => {
  const deleted = (n: number, jobId: string | null = "job-1") =>
    Effect.succeed({
      kind: "deleted",
      deleted: Array.from({ length: n }, (_, i) => `r${i}`),
      skipped: 0,
      notFound: 0,
      jobId,
    });

  it("is 401 without a workspace, 403 cross-origin and 403 while impersonating", async () => {
    state.scope = null;
    expect(
      (await remove.POST(post("/api/receipts/delete", { organizationId: ORG, ids: [A] }))).status,
    ).toBe(401);
    state.scope = owner;
    expect(
      (await remove.POST(post("/api/receipts/delete", { organizationId: ORG, ids: [A] }, {})))
        .status,
    ).toBe(403);
    state.scope = { ...owner, impersonatedBy: "admin-1" };
    expect(
      (await remove.POST(post("/api/receipts/delete", { organizationId: ORG, ids: [A] }))).status,
    ).toBe(403);
    expect(repo.removeMany).not.toHaveBeenCalled();
  });

  it("is 409 when the selection was made in another workspace", async () => {
    const res = await remove.POST(
      post("/api/receipts/delete", { organizationId: "org-2", ids: [A] }),
    );
    expect(res.status).toBe(409);
    expect(repo.removeMany).not.toHaveBeenCalled();
  });

  it("is 400 for a filter key or value it doesn't recognise, never a wider delete", async () => {
    for (const filter of ["status=failed&evil=1", "from=notaday", "status=everything", "q=a&q=b"]) {
      const res = await remove.POST(
        post("/api/receipts/delete", { organizationId: ORG, filter, expected: 3 }),
      );
      expect(res.status, filter).toBe(400);
    }
    expect(
      (await remove.POST(post("/api/receipts/delete", { organizationId: ORG, ids: ["x"] }))).status,
    ).toBe(400);
    expect(repo.removeMany).not.toHaveBeenCalled();
  });

  it("deletes by ids, answers the counts and starts the file job", async () => {
    repo.removeMany.mockReturnValue(deleted(1));
    const res = await json(
      await remove.POST(post("/api/receipts/delete", { organizationId: ORG, ids: [A] })),
    );
    expect(res).toEqual({ status: 200, body: { deleted: 1, skipped: 0, notFound: 0 } });
    expect(repo.removeMany).toHaveBeenCalledWith(owner, { ids: [A] });
    expect(kickJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ trigger: "delete" }));
  });

  it("passes cleaned filters and the confirmed count; a changed list is 409", async () => {
    repo.removeMany.mockReturnValue(Effect.succeed({ kind: "changed", matched: 4 }));
    const res = await remove.POST(
      post("/api/receipts/delete", {
        organizationId: ORG,
        filter: "status=failed&q=cafe",
        expected: 3,
      }),
    );
    expect(res.status).toBe(409);
    expect(repo.removeMany).toHaveBeenCalledWith(owner, {
      filters: expect.objectContaining({ status: "failed", q: "cafe" }),
      expected: 3,
    });
    expect(kickJob).not.toHaveBeenCalled();
  });
});

describe("GET /api/receipts/ids", () => {
  it("is 401 without a workspace and 409 for another workspace", async () => {
    state.scope = null;
    expect((await ids.GET(get(`/api/receipts/ids?org=${ORG}`))).status).toBe(401);
    state.scope = owner;
    expect((await ids.GET(get("/api/receipts/ids?org=org-2"))).status).toBe(409);
    expect((await ids.GET(get("/api/receipts/ids"))).status).toBe(409);
  });

  it("is 400 for an unknown param", async () => {
    expect((await ids.GET(get(`/api/receipts/ids?org=${ORG}&ids=${A}`))).status).toBe(400);
    expect(repo.matchingIds).not.toHaveBeenCalled();
  });

  it("returns at most the bulk limit and says when there were more", async () => {
    repo.matchingIds.mockReturnValue(
      Effect.succeed(Array.from({ length: 1001 }, (_, i) => `r${i}`)),
    );
    const res = await json(await ids.GET(get(`/api/receipts/ids?org=${ORG}&status=failed`)));
    expect(res.status).toBe(200);
    expect(res.body.ids).toHaveLength(1000);
    expect(res.body.truncated).toBe(true);
    expect(repo.matchingIds).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ status: "failed" }),
      1001,
      undefined,
    );
  });
});

describe("/api/receipts/export", () => {
  it("POST is 401, 403 cross-origin, 409 for another workspace and 400 for bad ids", async () => {
    state.scope = null;
    expect(
      (await exporter.POST(post("/api/receipts/export", { organizationId: ORG, ids: [A] }))).status,
    ).toBe(401);
    state.scope = owner;
    expect(
      (await exporter.POST(post("/api/receipts/export", { organizationId: ORG, ids: [A] }, {})))
        .status,
    ).toBe(403);
    expect(
      (await exporter.POST(post("/api/receipts/export", { organizationId: "org-2", ids: [A] })))
        .status,
    ).toBe(409);
    expect(
      (await exporter.POST(post("/api/receipts/export", { organizationId: ORG, ids: ["x"] })))
        .status,
    ).toBe(400);
    expect(repo.exportRows).not.toHaveBeenCalled();
  });

  it("POST exports only the selected ids", async () => {
    repo.exportRows.mockReturnValue(Effect.succeed([]));
    const res = await exporter.POST(
      post("/api/receipts/export", { organizationId: ORG, ids: [A] }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(repo.exportRows).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ ids: [A] }),
      5001,
      undefined,
    );
  });

  it("GET with ?org= from a selection is 409 for another workspace", async () => {
    expect((await exporter.GET(get("/api/receipts/export?org=org-2"))).status).toBe(409);
    repo.exportRows.mockReturnValue(Effect.succeed([]));
    expect((await exporter.GET(get(`/api/receipts/export?org=${ORG}`))).status).toBe(200);
  });
});
