import { Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const runPromiseExit = vi.fn();
const authApi = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
  get: (target, name: string) => (target[name] ??= vi.fn()),
});

const requireAdmin = vi.fn();
vi.mock("@/lib/session", () => ({ requireAdmin }));
vi.mock("@/lib/runtime", () => ({ runtime: { runPromiseExit } }));
vi.mock("@/lib/auth", () => ({ auth: { api: authApi } }));
vi.mock("@/lib/http", () => ({ clientIp: () => null }));
vi.mock("@/lib/log", async () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  errorFields: (await import("@receipt-ocr/core/telemetry")).errorFields,
}));
const sendTestEmail = vi.fn();
vi.mock("@/lib/test-email", () => ({ sendTestEmail }));
vi.mock("@/lib/plan-limits", () => ({ revalidatePlanCopy: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const actions = await import("./actions");

const calls: [string, () => Promise<unknown>][] = [
  ["setRoleAction", () => actions.setRoleAction({ userId: "u", role: "admin" })],
  ["setPlanAction", () => actions.setPlanAction({ userId: "u", plan: "pro" })],
  ["banUserAction", () => actions.banUserAction({ userId: "u", reason: "spam", days: 7 })],
  ["unbanUserAction", () => actions.unbanUserAction({ userId: "u" })],
  ["revokeUserSessionsAction", () => actions.revokeUserSessionsAction({ userId: "u" })],
  [
    "revokeUserSessionAction",
    () => actions.revokeUserSessionAction({ userId: "u", sessionId: "s" }),
  ],
  ["resendVerificationAction", () => actions.resendVerificationAction({ userId: "u" })],
  ["deleteUserAction", () => actions.deleteUserAction({ userId: "u", confirm: "u@x.com" })],
  [
    "impersonateUserAction",
    () => actions.impersonateUserAction({ userId: "u", reason: "support ticket 42" }),
  ],
  [
    "setMemberRoleAction",
    () => actions.setMemberRoleAction({ organizationId: "o", memberId: "m", role: "owner" }),
  ],
  ["removeMemberAction", () => actions.removeMemberAction({ organizationId: "o", memberId: "m" })],
  [
    "cancelInvitationAction",
    () => actions.cancelInvitationAction({ organizationId: "o", invitationId: "i" }),
  ],
  [
    "deleteWorkspaceAction",
    () => actions.deleteWorkspaceAction({ organizationId: "o", confirm: "Acme" }),
  ],
  ["savePlansAction", () => actions.savePlansAction({})],
  ["saveOcrAction", () => actions.saveOcrAction({})],
  ["checkConnectionsAction", () => actions.checkConnectionsAction()],
  ["checkChainProvidersAction", () => actions.checkChainProvidersAction({})],
  ["sendTestEmailAction", () => actions.sendTestEmailAction()],
];

beforeEach(() => {
  runPromiseExit.mockReset();
  for (const fn of Object.values(authApi)) fn.mockReset();
  // What next/navigation's notFound() throws for a signed-in non-admin.
  requireAdmin.mockRejectedValue(new Error(NOT_FOUND));
});

describe("admin server actions for a non-admin", () => {
  it("covers every exported action", () => {
    const exported = Object.entries(actions)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);
    expect(calls.map(([name]) => name).sort()).toEqual(exported.sort());
  });

  it.each(calls)("%s 404s before reading or changing anything", async (_name, call) => {
    await expect(call()).rejects.toThrow(NOT_FOUND);
    expect(runPromiseExit).not.toHaveBeenCalled();
    for (const fn of Object.values(authApi)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("admin server actions for an admin", () => {
  const adminTarget = { id: "u", email: "other-admin@x.com", role: "admin", emailVerified: true };

  beforeEach(() => {
    requireAdmin.mockResolvedValue({ user: { id: "me", email: "me@x.com", role: "admin" } });
  });

  it.each([
    ["ban", () => actions.banUserAction({ userId: "u", reason: "spam", days: 7 })],
    ["delete", () => actions.deleteUserAction({ userId: "u", confirm: adminTarget.email })],
  ])("refuses to %s another admin until they are demoted", async (_verb, call) => {
    runPromiseExit.mockResolvedValue(Exit.succeed(adminTarget));
    const result = await call();
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Remove their admin role first/),
    });
    expect(runPromiseExit).toHaveBeenCalledTimes(1); // the target lookup only
    for (const fn of Object.values(authApi)) expect(fn).not.toHaveBeenCalled();
  });

  it("writes the audit row before a Better Auth change, and a failure row when it fails", async () => {
    const order: string[] = [];
    runPromiseExit.mockImplementation(async () => {
      order.push(runPromiseExit.mock.calls.length === 1 ? "lookup" : "audit");
      return Exit.succeed({ ...adminTarget, role: "user" });
    });
    authApi.setRole!.mockImplementation(async () => {
      order.push("setRole");
      throw new Error("adapter down");
    });
    const result = await actions.setRoleAction({ userId: "u", role: "admin" });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(order).toEqual(["lookup", "audit", "setRole", "audit"]);
  });
});

describe("connection checks for an admin", () => {
  beforeEach(() => {
    sendTestEmail.mockReset();
    requireAdmin.mockResolvedValue({ user: { id: "me", email: "me@x.com", role: "admin" } });
  });

  it("tells a rate-limited admin to wait instead of running the checks", async () => {
    runPromiseExit.mockResolvedValue(Exit.succeed({ limited: true, retryAfterSeconds: 12 }));
    expect(await actions.checkConnectionsAction()).toEqual({
      ok: false,
      error: expect.stringContaining("12 seconds"),
    });
  });

  it("returns the rows from a run", async () => {
    const rows = [{ id: "storage", label: "File storage", status: "ok", latencyMs: 5, hint: "" }];
    runPromiseExit.mockResolvedValue(Exit.succeed(rows));
    expect(await actions.checkConnectionsAction()).toEqual({ ok: true, rows });
  });

  it("sends the test email only to the signed-in admin, then records the outcome", async () => {
    runPromiseExit.mockResolvedValue(Exit.succeed({ allowed: true, retryAfterSeconds: 1 }));
    sendTestEmail.mockResolvedValue("sent");
    expect(await actions.sendTestEmailAction()).toEqual({ ok: true, outcome: "sent" });
    expect(sendTestEmail).toHaveBeenCalledExactlyOnceWith("me@x.com");
    expect(runPromiseExit).toHaveBeenCalledTimes(2); // limiter, then audit
  });

  it("does not send when the hourly limit is used up", async () => {
    runPromiseExit.mockResolvedValue(Exit.succeed({ allowed: false, retryAfterSeconds: 1800 }));
    const result = await actions.sendTestEmailAction();
    expect(result).toEqual({ ok: false, error: expect.stringContaining("30 minutes") });
    expect(sendTestEmail).not.toHaveBeenCalled();
  });
});
