import { afterEach, describe, expect, it, vi } from "vitest";

const otlp = vi.hoisted(() => ({ loaded: false, start: vi.fn(async () => ({})) }));
vi.mock("@receipt-ocr/core/telemetry/otlp", () => {
  otlp.loaded = true;
  return { startOtlpExport: otlp.start };
});

const { startTelemetryExport } = await import("./instrumentation-node");
// Loaded here, not inside the first test's timeout (it is what startTelemetryExport imports first).
await import("@receipt-ocr/core/telemetry");

afterEach(() => {
  process.removeAllListeners("SIGTERM");
});

describe("startTelemetryExport", () => {
  it("loads no OpenTelemetry code without an endpoint", async () => {
    await startTelemetryExport({});
    await startTelemetryExport({ OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer x" });
    expect(otlp.loaded).toBe(false);
    expect(process.listenerCount("SIGTERM")).toBe(0);
  });

  it("starts the exporter with an endpoint and flushes on SIGTERM", async () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.axiom.co" };
    await startTelemetryExport(env);
    expect(otlp.start).toHaveBeenCalledWith({ env });
    expect(process.listenerCount("SIGTERM")).toBe(1);
  });

  it("keeps booting when the exporter can't start", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    otlp.start.mockRejectedValueOnce(new Error("bad header"));
    await expect(
      startTelemetryExport({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.axiom.co" }),
    ).resolves.toBeUndefined();
    expect(String(error.mock.calls[0]?.[0])).toContain("telemetry.start_failed");
    expect(String(error.mock.calls[0]?.[0])).not.toContain("bad header");
  });
});
