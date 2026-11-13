import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ noteFailedRender: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/log", async () => ({
  errorFields: (await import("@receipt-ocr/core/telemetry")).errorFields,
  logger: { error: log.error },
  noteFailedRender: log.noteFailedRender,
}));

const { onRequestError } = await import("@/instrumentation");
// What onRequestError imports on first use, loaded here rather than inside a test's timeout.
await Promise.all([
  import("@/lib/log"),
  import("@/lib/request-id"),
  import("@/lib/telemetry/errors"),
]);

const fail = (routePath: string, routeType: "render" | "route" = "render") =>
  onRequestError(
    new Error("x"),
    {
      path: routePath,
      method: "GET",
      headers: { "x-request-id": "0f8fad5b-d9cb-469f-a165-70867728950e" },
    },
    {
      routerKind: "App Router",
      routePath,
      routeType,
      renderSource: "react-server-components",
      revalidateReason: undefined,
    },
  );

beforeEach(() => {
  log.noteFailedRender.mockReset();
  log.error.mockReset();
});

describe("onRequestError", () => {
  it("hands /app and /admin render failures to their page.render event", async () => {
    await fail("/app/receipts/[id]");
    await fail("/admin");
    expect(log.noteFailedRender).toHaveBeenCalledTimes(2);
  });

  it("logs public-page and route failures without filling the failed-render map", async () => {
    await fail("/pricing");
    await fail("/");
    await fail("/app/x", "route");
    expect(log.noteFailedRender).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(3);
  });
});
