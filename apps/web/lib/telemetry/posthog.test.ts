import { flushEventSinks, logger, shutdownEventSinks } from "@receipt-ocr/core/telemetry";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setProductEventSender, track } from "./analytics";
import { parsePostHog } from "./posthog-config";
import { notePostHogFailure, startPostHog } from "./posthog";

vi.mock("server-only", () => ({}));

const onError: ((error: unknown) => void)[] = [];
const client = {
  capture: vi.fn(),
  flush: vi.fn(async () => {}),
  shutdown: vi.fn(async () => {}),
  on: vi.fn((event: string, cb: (error: unknown) => void) => {
    if (event === "error") onError.push(cb);
    return () => {};
  }),
};

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  startPostHog({ key: "phc_test", host: "https://us.i.posthog.com" }, {}, client as never);
});

afterAll(async () => {
  setProductEventSender(undefined);
  await shutdownEventSinks();
  vi.restoreAllMocks();
});

describe("PostHog on the server", () => {
  it("turns finished units of work into named events, after the logger's allowlist", async () => {
    logger.emit({
      event: "receipt.upload",
      unit: "request",
      status_code: 200,
      user_id: "u_1",
      organization_id: "org_1",
      mode: "instant",
      plan: "free",
      merchant: "Dr Smith Clinic",
    } as never);
    await flushEventSinks();
    expect(client.capture).toHaveBeenCalledWith({
      distinctId: "u_1",
      event: "receipt_uploaded",
      properties: { mode: "instant", plan: "free", workspace_id: "org_1", $geoip_disable: true },
      groups: { workspace: "org_1" },
    });
    expect(client.flush).toHaveBeenCalled();
    expect(JSON.stringify(client.capture.mock.calls)).not.toContain("Dr Smith");
  });

  it("captures nothing an admin did while impersonating: an export or a scan", async () => {
    client.capture.mockClear();
    const who = { user_id: "u_1", organization_id: "org_1", impersonated_by: "admin_1" };
    logger.emit({
      ...who,
      event: "receipt.export",
      unit: "request",
      status_code: 200,
      count: 3,
    });
    logger.emit({
      ...who,
      event: "job.attempt",
      unit: "job_attempt",
      trigger: "upload",
      queue: { outcome: "succeeded" },
      ocr: { model: "fixture", calls: 1 },
    });
    logger.emit({
      ...who,
      event: "job.attempt",
      unit: "job_attempt",
      queue: { outcome: "dead", error_kind: "timeout" },
    });
    await flushEventSinks();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it("sends track() events through the same check", () => {
    client.capture.mockClear();
    track({
      name: "signed_up",
      userId: "u_2",
      props: { method: "email", email: "jane@example.com" },
    });
    expect(client.capture).toHaveBeenCalledWith({
      distinctId: "u_2",
      event: "signed_up",
      properties: { method: "email", $geoip_disable: true },
    });
  });
});

describe("PostHog send failures", () => {
  it("log one local notice a minute, never to the sinks", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const emit = vi.spyOn(logger, "emit");
    client.flush.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(flushEventSinks()).resolves.toBeUndefined();
    for (const cb of onError) cb(new TypeError("fetch failed"));
    for (const cb of onError) cb(new TypeError("fetch failed"));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      {
        event: "telemetry.export_failed",
        unit: "log",
        kind: "posthog",
        error: { class: "TypeError" },
      },
      { level: "error", localOnly: true },
    );
    expect(error).toHaveBeenCalledTimes(1);
    notePostHogFailure(new Error("later"), Date.now() + 61_000);
    expect(emit).toHaveBeenCalledTimes(2);
    emit.mockRestore();
  });
});

describe("parsePostHog", () => {
  it("needs a project key and an https host", () => {
    expect(parsePostHog({})).toBeNull();
    expect(parsePostHog({ POSTHOG_KEY: "phx_personalkeythatcanreadeverything" })).toBeNull();
    expect(parsePostHog({ POSTHOG_KEY: "phc_0123456789abcdefABCD" })).toEqual({
      key: "phc_0123456789abcdefABCD",
      host: "https://us.i.posthog.com",
    });
    expect(
      parsePostHog({
        POSTHOG_KEY: "phc_0123456789abcdefABCD",
        POSTHOG_HOST: "https://eu.i.posthog.com/",
      }),
    ).toEqual({ key: "phc_0123456789abcdefABCD", host: "https://eu.i.posthog.com" });
    expect(
      parsePostHog({
        POSTHOG_KEY: "phc_0123456789abcdefABCD",
        POSTHOG_HOST: "http://eu.i.posthog.com",
      }),
    ).toBeNull();
  });
});
