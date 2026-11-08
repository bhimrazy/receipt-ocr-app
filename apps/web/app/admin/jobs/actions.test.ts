import { Conflict } from "@receipt-ocr/core";
import { Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const runPromiseExit = vi.fn();
const requireAdmin = vi.fn();
const after = vi.fn();
const drainJobs = vi.fn();
vi.mock("@/lib/session", () => ({ requireAdmin }));
const requireStepUp = vi.fn();
vi.mock("@/lib/step-up-check", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/lib/step-up-check")),
  requireStepUp,
}));
vi.mock("@/lib/runtime", () => ({ runtime: { runPromiseExit } }));
vi.mock("@/lib/http", () => ({ clientIp: () => "203.0.113.1" }));
vi.mock("@/lib/jobs", () => ({ drainJobs, ROUTE_BUDGET_MS: 290_000 }));
vi.mock("@/lib/log", async () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  errorFields: (await import("@receipt-ocr/core/telemetry")).errorFields,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after }));

const actions = await import("./actions");
const JOB = "6f1c2c1e-6a0b-4b7e-9d3c-2f1a7c9e0b11";

const calls: [string, () => Promise<unknown>][] = [
  ["rerunJobAction", () => actions.rerunJobAction({ jobId: JOB, reason: "outage" })],
  ["cancelJobAction", () => actions.cancelJobAction({ jobId: JOB, reason: "stuck" })],
  [
    "setQueueControlAction",
    () => actions.setQueueControlAction({ scope: "queue", paused: true, reason: "incident" }),
  ],
];

beforeEach(() => {
  requireStepUp.mockReset().mockResolvedValue(undefined);
  runPromiseExit.mockReset();
  after.mockReset();
  requireAdmin.mockRejectedValue(new Error(NOT_FOUND));
});

describe("job admin actions for a non-admin", () => {
  it("covers every exported action", () => {
    const exported = Object.entries(actions)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);
    expect(calls.map(([name]) => name).sort()).toEqual(exported.sort());
  });

  it.each(calls)("%s 404s before touching the queue", async (_name, call) => {
    await expect(call()).rejects.toThrow(NOT_FOUND);
    expect(runPromiseExit).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});

describe("job admin actions without a fresh step-up", () => {
  it.each(calls)("%s asks for step-up before touching the queue", async (_name, call) => {
    const { StepUpRequiredError } = await import("@/lib/step-up-check");
    requireAdmin.mockResolvedValue({ session: { id: "s" }, user: { id: "a", email: "a@x.com" } });
    requireStepUp.mockImplementation(async (_session, action) => {
      throw new StepUpRequiredError(action, "required");
    });
    expect(await call()).toMatchObject({ ok: false, code: "STEP_UP_REQUIRED" });
    expect(runPromiseExit).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});

describe("job admin actions for an admin", () => {
  beforeEach(() => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", email: "admin@x.com" } });
  });

  it("refuses a missing reason or a bad id without calling core", async () => {
    expect(await actions.rerunJobAction({ jobId: JOB, reason: " " })).toEqual({
      ok: false,
      error: "Write a reason (at least 3 characters).",
    });
    expect(await actions.cancelJobAction({ jobId: "nope", reason: "stuck" })).toEqual({
      ok: false,
      error: "That isn't a job id.",
    });
    expect(runPromiseExit).not.toHaveBeenCalled();
  });

  it("re-runs through core, then drains the queue for that job after the response", async () => {
    runPromiseExit.mockResolvedValueOnce(Exit.succeed(undefined)); // daily cap: none
    runPromiseExit.mockResolvedValueOnce(Exit.succeed({ id: JOB, round: 1 }));
    expect(await actions.rerunJobAction({ jobId: JOB, reason: "outage" })).toEqual({ ok: true });
    expect(runPromiseExit).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenCalledTimes(1);
    after.mock.calls[0]![0]();
    expect(drainJobs).toHaveBeenCalledWith(
      expect.any(Number),
      { trigger: "admin_rerun", job_id: JOB },
      [JOB],
    );
  });

  it("passes a core refusal through as the message and schedules nothing", async () => {
    runPromiseExit.mockResolvedValueOnce(Exit.succeed(undefined));
    runPromiseExit.mockResolvedValueOnce(
      Exit.fail(new Conflict({ message: "Only dead or cancelled jobs can be re-run." })),
    );
    expect(await actions.rerunJobAction({ jobId: JOB, reason: "outage" })).toEqual({
      ok: false,
      error: "Only dead or cancelled jobs can be re-run.",
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind a generic message", async () => {
    runPromiseExit.mockResolvedValueOnce(Exit.die(new Error("connection reset")));
    const result = await actions.setQueueControlAction({
      scope: "queue",
      paused: true,
      reason: "x".repeat(5),
    });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("connection reset");
  });
});
