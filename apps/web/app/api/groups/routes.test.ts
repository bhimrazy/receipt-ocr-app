import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scope: null as null | { organizationId: string; userId: string; role: string },
}));
const core = vi.hoisted(() => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addReceiptsToGroup: vi.fn(),
  removeReceiptsFromGroup: vi.fn(),
  groupsOfReceipt: vi.fn(),
  setReceiptGroup: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  authEnv: {
    betterAuthUrl: "https://app.example",
    trustedOrigins: ["https://app.example"],
    ipAddress: {},
  },
}));
const emit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logger: { emit, error: vi.fn(), info: vi.fn() },
}));
// The core functions are mocked as plain Effects, so the runtime needs no services.
vi.mock("@/lib/runtime", () => ({
  runtime: { runPromiseExit: (effect: Effect.Effect<unknown>) => Effect.runPromiseExit(effect) },
}));
vi.mock("@/lib/session", () => ({ getActiveScope: async () => state.scope }));
vi.mock("@receipt-ocr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/core")>()),
  ...core,
}));

const { Conflict, Forbidden, NotFound } = await import("@receipt-ocr/core");
const groups = await import("./route");
const group = await import("./[id]/route");
const members = await import("./[id]/receipts/route");
const receiptGroups = await import("../receipts/[id]/groups/route");

const ORIGIN = "https://app.example";
const GROUP_ID = "6f1c1d1e-7a3b-4c2d-9e8f-0a1b2c3d4e5f";
const RECEIPT_ID = "0b6a3c1e-2d4f-4a5b-8c7d-9e0f1a2b3c4d";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/groups", {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  state.scope = { organizationId: "o1", userId: "u1", role: "member" };
  for (const fn of Object.values(core)) fn.mockReset();
  emit.mockReset();
});

/** The one wide event the last request wrote, after the allowlist. */
async function lastEvent() {
  const { formatEvent } = await import("@receipt-ocr/core/telemetry");
  expect(emit).toHaveBeenCalledTimes(1);
  const line = formatEvent(emit.mock.calls[0]![0])!.line;
  return { line, event: JSON.parse(line) as Record<string, unknown> };
}

describe("same-origin and session checks", () => {
  const mutations = [
    () =>
      groups.POST(
        request("POST", { name: "Trip", color: "green" }, { origin: "https://evil.example" }),
      ),
    () =>
      group.PATCH(
        request("PATCH", { color: "red" }, { origin: "https://evil.example" }),
        params(GROUP_ID),
      ),
    () =>
      group.DELETE(
        request("DELETE", undefined, { origin: "https://evil.example" }),
        params(GROUP_ID),
      ),
    () =>
      members.POST(
        request("POST", { receiptIds: [RECEIPT_ID] }, { origin: "https://evil.example" }),
        params(GROUP_ID),
      ),
    () =>
      members.DELETE(
        request("DELETE", { receiptIds: [RECEIPT_ID] }, { origin: "https://evil.example" }),
        params(GROUP_ID),
      ),
    () =>
      receiptGroups.POST(
        request("POST", { groupId: GROUP_ID }, { origin: "https://evil.example" }),
        params(RECEIPT_ID),
      ),
    () =>
      receiptGroups.DELETE(
        request("DELETE", { groupId: GROUP_ID }, { origin: "https://evil.example" }),
        params(RECEIPT_ID),
      ),
  ];

  it("rejects every cross-origin mutation before touching core", async () => {
    for (const call of mutations) expect((await call()).status).toBe(403);
    for (const fn of Object.values(core)) expect(fn).not.toHaveBeenCalled();
  });

  it("answers 401 without a workspace session", async () => {
    state.scope = null;
    expect((await groups.GET(request("GET"))).status).toBe(401);
    expect((await groups.POST(request("POST", { name: "Trip", color: "green" }))).status).toBe(401);
    expect((await receiptGroups.GET(request("GET"), params(RECEIPT_ID))).status).toBe(401);
    for (const fn of Object.values(core)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("POST /api/groups", () => {
  it("creates with the trimmed name and the caller's scope", async () => {
    core.createGroup.mockReturnValue(Effect.succeed({ id: GROUP_ID, name: "Berlin trip" }));
    const res = await json(
      await groups.POST(request("POST", { name: "  Berlin  trip ", color: "blue" })),
    );
    expect(res.status).toBe(201);
    expect(core.createGroup).toHaveBeenCalledWith(state.scope, {
      name: "Berlin trip",
      color: "blue",
    });
    const { line, event } = await lastEvent();
    expect(event).toMatchObject({
      event: "group.create",
      unit: "request",
      route: "/api/groups",
      status_code: 201,
      user_id: "u1",
      organization_id: "o1",
      group_id: GROUP_ID,
    });
    expect(event.dropped_fields).toBeUndefined();
    expect(line).not.toMatch(/Berlin|blue/);
  });

  it("refuses bad input with a readable message", async () => {
    const cases: [unknown, number, RegExp][] = [
      ["{not json", 400, /Invalid request body/],
      [{ name: "", color: "green" }, 400, /Enter a group name/],
      [{ name: "x".repeat(61), color: "green" }, 400, /up to 60/],
      [{ name: "Trip", color: "chartreuse" }, 400, /colour/],
      [{ name: "Trip", color: "green", organizationId: "o2" }, 400, /./],
    ];
    for (const [body, status, message] of cases) {
      const res = await json(await groups.POST(request("POST", body)));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(message);
    }
    expect(core.createGroup).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    const res = await groups.POST(
      request("POST", { name: "Trip", color: "green", pad: "x".repeat(20_000) }),
    );
    expect(res.status).toBe(413);
  });
});

describe("PATCH and DELETE /api/groups/[id]", () => {
  it("maps a permission refusal to 403 with its message", async () => {
    core.updateGroup.mockReturnValue(
      Effect.fail(new Forbidden({ message: "Only the person who created this group…" })),
    );
    const res = await json(await group.PATCH(request("PATCH", { color: "red" }), params(GROUP_ID)));
    expect(res).toEqual({
      status: 403,
      body: { error: "Only the person who created this group…" },
    });
    const { line, event } = await lastEvent();
    expect(event).toMatchObject({
      event: "group.update",
      status_code: 403,
      outcome: "Forbidden",
      group_id: GROUP_ID,
      flags: { renamed: false, recoloured: true },
      error: { type: "Forbidden" },
    });
    expect(line).not.toMatch(/created this group|"red"/);
  });

  it("needs something to change", async () => {
    const res = await json(await group.PATCH(request("PATCH", {}), params(GROUP_ID)));
    expect(res.status).toBe(400);
    expect(core.updateGroup).not.toHaveBeenCalled();
  });

  it("deletes through core and 404s an unknown group", async () => {
    core.deleteGroup.mockReturnValue(Effect.fail(new NotFound({ message: "Group not found" })));
    expect((await group.DELETE(request("DELETE"), params(GROUP_ID))).status).toBe(404);
    expect(core.deleteGroup).toHaveBeenCalledWith(state.scope, GROUP_ID);
  });
});

describe("bulk /api/groups/[id]/receipts", () => {
  it("adds deduplicated ids and returns the counts", async () => {
    const result = { changed: 1, unchanged: 0, atLimit: 0, notFound: 0 };
    core.addReceiptsToGroup.mockReturnValue(Effect.succeed(result));
    const res = await json(
      await members.POST(
        request("POST", { receiptIds: [RECEIPT_ID, RECEIPT_ID.toUpperCase()] }),
        params(GROUP_ID),
      ),
    );
    expect(res).toEqual({ status: 200, body: result });
    expect(core.addReceiptsToGroup).toHaveBeenCalledWith(state.scope, GROUP_ID, [RECEIPT_ID]);
    const { event } = await lastEvent();
    expect(event).toMatchObject({
      event: "group.receipts_add",
      group_id: GROUP_ID,
      count: 1,
      counts: { changed: 1, unchanged: 0, at_limit: 0, not_found: 0 },
    });
  });

  it("takes 1 to 100 UUIDs", async () => {
    for (const receiptIds of [
      [],
      ["nope"],
      Array.from({ length: 101 }, () => crypto.randomUUID()),
    ]) {
      const res = await members.DELETE(request("DELETE", { receiptIds }), params(GROUP_ID));
      expect(res.status).toBe(400);
    }
    expect(core.removeReceiptsFromGroup).not.toHaveBeenCalled();
  });
});

describe("/api/receipts/[id]/groups", () => {
  it("adds the receipt and returns its groups", async () => {
    const list = [{ id: GROUP_ID, name: "Trip", color: "green" }];
    core.setReceiptGroup.mockReturnValue(Effect.succeed(list));
    const res = await json(
      await receiptGroups.POST(request("POST", { groupId: GROUP_ID }), params(RECEIPT_ID)),
    );
    expect(res).toEqual({ status: 200, body: { groups: list } });
    expect(core.setReceiptGroup).toHaveBeenCalledWith(state.scope, RECEIPT_ID, GROUP_ID, "add");
    const { line, event } = await lastEvent();
    expect(event).toMatchObject({
      event: "receipt.group_add",
      route: "/api/receipts/[id]/groups",
      receipt_id: RECEIPT_ID,
      group_id: GROUP_ID,
      count: 1,
    });
    expect(line).not.toMatch(/Trip|green/);
  });

  it("removes with DELETE", async () => {
    core.setReceiptGroup.mockReturnValue(Effect.succeed([]));
    const res = await receiptGroups.DELETE(
      request("DELETE", { groupId: GROUP_ID }),
      params(RECEIPT_ID),
    );
    expect(res.status).toBe(200);
    expect(core.setReceiptGroup).toHaveBeenCalledWith(state.scope, RECEIPT_ID, GROUP_ID, "remove");
  });

  it("409s with the core message when the receipt is in the most groups it can be in", async () => {
    core.setReceiptGroup.mockReturnValue(
      Effect.fail(new Conflict({ message: "A receipt can be in up to 20 groups." })),
    );
    const res = await json(
      await receiptGroups.POST(request("POST", { groupId: GROUP_ID }), params(RECEIPT_ID)),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/up to 20 groups/);
  });

  it("404s a receipt from another workspace", async () => {
    core.setReceiptGroup.mockReturnValue(
      Effect.fail(new NotFound({ message: "Receipt not found" })),
    );
    const res = await receiptGroups.DELETE(
      request("DELETE", { groupId: GROUP_ID }),
      params(RECEIPT_ID),
    );
    expect(res.status).toBe(404);
  });
});
