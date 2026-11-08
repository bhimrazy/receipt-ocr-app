import { addEventSink, setFlushScheduler, type EventRecord } from "@receipt-ocr/core/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkEvent,
  fromRecord,
  setProductEventSender,
  signUpMethod,
  track,
  type ProductEvent,
} from "./analytics";

const record = (fields: Record<string, unknown>): EventRecord => ({
  timestamp: "2026-11-08T00:00:00.000Z",
  level: "info",
  event: "x",
  ...fields,
});

afterEach(() => setProductEventSender(undefined));

describe("checkEvent (the allowlist)", () => {
  it("keeps only known props of the right kind", () => {
    expect(
      checkEvent({
        name: "receipt_uploaded",
        userId: "u_1",
        workspaceId: "org_1",
        props: { mode: "instant", plan: "free", email: "jane@example.com", merchant: "Dr Smith" },
      }),
    ).toEqual({
      name: "receipt_uploaded",
      userId: "u_1",
      workspaceId: "org_1",
      // A plain prop as well: `groups` needs PostHog's paid group analytics.
      props: { mode: "instant", plan: "free", workspace_id: "org_1" },
    });
    expect(
      checkEvent({ name: "csv_exported", userId: "u_1", props: { count: "12" } })?.props,
    ).toEqual({});
    expect(
      checkEvent({ name: "signed_up", userId: "u_1", props: { method: "jane doe" } })?.props,
    ).toEqual({});
  });

  it("refuses unknown events and ids that aren't opaque ids", () => {
    expect(checkEvent({ name: "page_viewed" as never, userId: "u_1" })).toBeNull();
    expect(checkEvent({ name: "toString" as never, userId: "u_1" })).toBeNull();
    expect(checkEvent({ name: "signed_up", userId: "jane@example.com" })).toBeNull();
    expect(
      checkEvent({ name: "signed_up", userId: "u_1", workspaceId: "Bhim's receipts" }),
    ).toBeNull();
  });
});

describe("fromRecord", () => {
  it("maps uploads, exports and quota rejections from request events", () => {
    const base = { unit: "request", user_id: "u_1", organization_id: "org_1" };
    expect(
      fromRecord(
        record({
          ...base,
          event: "receipt.upload",
          status_code: 202,
          mode: "queued",
          plan: "free",
        }),
      ),
    ).toMatchObject({
      name: "receipt_uploaded",
      props: { mode: "queued", plan: "free" },
    });
    expect(
      fromRecord(record({ ...base, event: "receipt.export", status_code: 200, count: 12 }))?.name,
    ).toBe("csv_exported");
    const quota = (kind: string, flags?: Record<string, boolean>) =>
      fromRecord(
        record({
          ...base,
          event: "receipt.retry",
          status_code: 429,
          outcome: "QuotaExceeded",
          plan: "free",
          error: { type: "QuotaExceeded", kind },
          ...(flags ? { flags } : {}),
        }),
      );
    expect(quota("day")).toMatchObject({
      name: "plan_limit_hit",
      props: { limit: "day", plan: "free" },
    });
    expect(quota("minute")?.props).toEqual({ limit: "minute", plan: "free" });
    // The service-wide cap isn't the user's plan, and a repeat in the same minute isn't news.
    expect(quota("global")).toBeNull();
    expect(quota("day", { quota_repeat: true })).toBeNull();
    expect(fromRecord(record({ ...base, event: "receipt.upload", status_code: 500 }))).toBeNull();
    expect(fromRecord(record({ ...base, event: "receipt.poll", status_code: 200 }))).toBeNull();
  });

  it("maps finished and dead job attempts", () => {
    const base = {
      unit: "job_attempt",
      user_id: "u_1",
      organization_id: "org_1",
      trigger: "upload",
    };
    expect(
      fromRecord(
        record({
          ...base,
          queue: { outcome: "succeeded" },
          ocr: { model: "anthropic:claude-haiku", fallback: false, calls: 1 },
        }),
      ),
    ).toMatchObject({
      name: "receipt_scanned",
      props: { trigger: "upload", model: "anthropic:claude-haiku", calls: 1 },
    });
    expect(
      fromRecord(record({ ...base, queue: { outcome: "dead", error_kind: "timeout" } })),
    ).toMatchObject({
      name: "receipt_scan_failed",
      props: { error_kind: "timeout" },
    });
    expect(fromRecord(record({ ...base, queue: { outcome: "retry" } }))).toBeNull();
    // An admin re-running the job isn't the user's scan.
    for (const outcome of ["succeeded", "dead"]) {
      expect(
        fromRecord(
          record({
            ...base,
            trigger: "admin_rerun",
            queue: { outcome },
            ocr: { model: "fixture" },
          }),
        ),
      ).toBeNull();
    }
  });

  it("never counts an admin impersonating a user, or events without a user", () => {
    expect(
      fromRecord(
        record({
          unit: "request",
          event: "receipt.export",
          status_code: 200,
          user_id: "u_1",
          impersonated_by: "admin_1",
        }),
      ),
    ).toBeNull();
    expect(
      fromRecord(record({ unit: "request", event: "receipt.export", status_code: 200 })),
    ).toBeNull();
  });
});

describe("track", () => {
  it("does nothing without PostHog, and sends checked events with it", () => {
    const event: ProductEvent = {
      name: "signed_up",
      userId: "u_1",
      props: { method: "github", name: "Jane" },
    };
    expect(() => track(event)).not.toThrow();
    const send = vi.fn();
    setProductEventSender(send);
    track(event);
    expect(send).toHaveBeenCalledWith({
      name: "signed_up",
      userId: "u_1",
      props: { method: "github" },
    });
  });

  it("schedules the sinks' flush, so an event outside a request's wide event still goes out", () => {
    const scheduler = vi.fn();
    const remove = addEventSink({
      write: () => {},
      flush: async () => {},
      shutdown: async () => {},
    });
    setFlushScheduler(scheduler);
    try {
      setProductEventSender(vi.fn());
      track({ name: "signed_up", userId: "u_1", props: { method: "email" } });
      expect(scheduler).toHaveBeenCalledTimes(1);
    } finally {
      setFlushScheduler(undefined);
      remove();
    }
  });

  it("never throws when the sender does", () => {
    setProductEventSender(() => {
      throw new Error("queue full");
    });
    expect(() => track({ name: "signed_up", userId: "u_1" })).not.toThrow();
  });
});

describe("signUpMethod", () => {
  it("reads the method from Better Auth's endpoint, never from user input", () => {
    expect(signUpMethod("/sign-up/email", undefined)).toBe("email");
    expect(signUpMethod("/callback/:id", "google")).toBe("google");
    expect(signUpMethod("/callback/:id", "github")).toBe("github");
    expect(signUpMethod("/callback/:id", "evil provider")).toBe("other");
    expect(signUpMethod(undefined, undefined)).toBe("other");
  });
});
