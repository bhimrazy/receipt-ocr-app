import { afterEach, describe, expect, it, vi } from "vitest";

const otlp = vi.hoisted(() => ({ loaded: false, start: vi.fn(async () => ({})) }));
vi.mock("@receipt-ocr/core/telemetry/otlp", () => {
  otlp.loaded = true;
  return { startOtlpExport: otlp.start };
});

const sentry = vi.hoisted(() => ({ loaded: false, start: vi.fn() }));
vi.mock("./lib/telemetry/sentry-server", () => {
  sentry.loaded = true;
  return { startSentryServer: sentry.start };
});

const posthog = vi.hoisted(() => ({ loaded: false, start: vi.fn() }));
vi.mock("./lib/telemetry/posthog", () => {
  posthog.loaded = true;
  return { startPostHog: posthog.start };
});

const { startErrorReporting, startProductAnalytics, startTelemetryExport } =
  await import("./instrumentation-node");
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

describe("startErrorReporting", () => {
  it("loads no Sentry code without a valid DSN", async () => {
    await startErrorReporting({});
    await startErrorReporting({ SENTRY_DSN: "sntrys_pasted_auth_token" });
    expect(sentry.loaded).toBe(false);
  });

  it("starts Sentry with a valid DSN", async () => {
    const dsn = "https://0123456789abcdef0123456789abcdef@o1.ingest.us.sentry.io/2";
    await startErrorReporting({ SENTRY_DSN: dsn });
    expect(sentry.start).toHaveBeenCalledWith(dsn, { SENTRY_DSN: dsn });
  });
});

describe("startProductAnalytics", () => {
  it("loads no PostHog code without a project key", async () => {
    await startProductAnalytics({});
    await startProductAnalytics({ POSTHOG_KEY: "phx_personalkeythatcanreadeverything" });
    expect(posthog.loaded).toBe(false);
  });

  it("starts PostHog with a project key", async () => {
    const env = {
      POSTHOG_KEY: "phc_0123456789abcdefABCD",
      POSTHOG_HOST: "https://us.i.posthog.com",
    };
    await startProductAnalytics(env);
    expect(posthog.start).toHaveBeenCalledWith(
      { key: "phc_0123456789abcdefABCD", host: "https://us.i.posthog.com" },
      env,
    );
  });
});
