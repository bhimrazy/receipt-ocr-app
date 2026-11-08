import { flushEventSinks, logger, shutdownEventSinks } from "@receipt-ocr/core/telemetry";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setProductEventSender, track } from "./analytics";
import { parsePostHog } from "./posthog-config";
import { startPostHog } from "./posthog";

vi.mock("server-only", () => ({}));

const client = { capture: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };

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
      properties: { mode: "instant", plan: "free", $geoip_disable: true },
      groups: { workspace: "org_1" },
    });
    expect(client.flush).toHaveBeenCalled();
    expect(JSON.stringify(client.capture.mock.calls)).not.toContain("Dr Smith");
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
