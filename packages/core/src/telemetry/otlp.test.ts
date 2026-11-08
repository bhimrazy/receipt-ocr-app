import { InMemoryLogRecordExporter, type LogRecordExporter } from "@opentelemetry/sdk-logs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addEventSink,
  flushEventSinks,
  logger,
  setFlushScheduler,
  shutdownEventSinks,
  type EventRecord,
  type EventSink,
} from "./logger";
import { otlpLogsConfigured, otlpLogsProtocol } from "./otlp-config";
import { flattenAttributes, startOtlpExport, toLogRecord } from "./otlp";

const captured = (): { sink: EventSink; records: EventRecord[] } => {
  const records: EventRecord[] = [];
  return {
    records,
    sink: {
      write: (record) => records.push(record),
      flush: async () => {},
      shutdown: async () => {},
    },
  };
};

let removals: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  for (const remove of removals) remove();
  removals = [];
  setFlushScheduler(undefined);
  await flushEventSinks();
  vi.restoreAllMocks();
});

describe("event sinks", () => {
  it("get exactly the object written to stdout, after sampling and the allowlist", () => {
    const { sink, records } = captured();
    removals.push(addEventSink(sink));
    logger.error({ event: "x", unit: "log", merchant: "Jane Doe Pharmacy" });
    const line = JSON.parse(vi.mocked(console.error).mock.calls[0]![0] as string);
    expect(records).toEqual([line]);
    expect(JSON.stringify(records)).not.toContain("Jane");
  });

  it("skip events the sampler drops and events marked local-only", () => {
    const { sink, records } = captured();
    removals.push(addEventSink(sink));
    vi.stubEnv("LOG_SAMPLE_RATE", "0.01");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    logger.emit({ event: "page.render", unit: "page", duration_ms: 3 }, { routine: true });
    logger.emit({ event: "y", unit: "log" }, { level: "error", localOnly: true });
    vi.unstubAllEnvs();
    expect(records).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("can throw or hang without breaking logging or the flush", async () => {
    removals.push(
      addEventSink({
        write: () => {
          throw new Error("boom");
        },
        flush: () => new Promise(() => {}),
        shutdown: async () => {},
      }),
    );
    expect(() => logger.info({ event: "x" })).not.toThrow();
    const started = Date.now();
    await flushEventSinks(50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("schedule one flush at a time, and the next once it has started", async () => {
    const { sink } = captured();
    removals.push(addEventSink(sink));
    const scheduler = vi.fn();
    setFlushScheduler(scheduler);
    logger.info({ event: "a" });
    logger.info({ event: "b" });
    expect(scheduler).toHaveBeenCalledTimes(1);
    await flushEventSinks();
    logger.info({ event: "c" });
    expect(scheduler).toHaveBeenCalledTimes(2);
  });

  it("schedule nothing without a sink, and retry when scheduling threw (outside a request)", () => {
    const scheduler = vi.fn(() => {
      throw new Error("after() outside a request scope");
    });
    setFlushScheduler(scheduler);
    logger.info({ event: "a" });
    expect(scheduler).not.toHaveBeenCalled();
    const { sink } = captured();
    removals.push(addEventSink(sink));
    logger.info({ event: "b" });
    logger.info({ event: "c" });
    expect(scheduler).toHaveBeenCalledTimes(2);
  });
});

describe("OTLP mapping", () => {
  it("flattens groups to dotted keys and keeps primitive lists", () => {
    expect(
      flattenAttributes({
        ocr: { model: "m", tokens_in: 812, nested: { deep: true } },
        notices: ["a", "b"],
        violations: [{ directive: "script-src" }],
        skipped: null,
      }),
    ).toEqual({
      "ocr.model": "m",
      "ocr.tokens_in": 812,
      "ocr.nested.deep": true,
      notices: ["a", "b"],
      violations: '[{"directive":"script-src"}]',
    });
  });

  it("maps level, name and time to the record and leaves deployment fields to the resource", () => {
    const record = toLogRecord({
      timestamp: "2026-11-08T00:00:00.000Z",
      level: "error",
      event: "receipt.upload",
      service: "web",
      version: "abc",
      env: "production",
      region: "iad1",
      instance: "h:1",
      status_code: 500,
    });
    expect(record).toEqual({
      timestamp: new Date("2026-11-08T00:00:00.000Z"),
      severityNumber: 17,
      severityText: "error",
      eventName: "receipt.upload",
      body: "receipt.upload",
      attributes: { status_code: 500 },
    });
  });
});

describe("otlp config", () => {
  it("is on only with an endpoint, and defaults to protobuf", () => {
    expect(otlpLogsConfigured({})).toBe(false);
    expect(otlpLogsConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBe(false);
    expect(otlpLogsConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.axiom.co" })).toBe(true);
    expect(otlpLogsConfigured({ OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://c:4318/v1/logs" })).toBe(
      true,
    );
    expect(otlpLogsProtocol({})).toBe("http/protobuf");
    expect(otlpLogsProtocol({ OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" })).toBe("http/protobuf");
    expect(otlpLogsProtocol({ OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" })).toBe("http/json");
  });
});

describe("startOtlpExport", () => {
  it("exports scrubbed events with the deployment as the resource, and reports failures on stdout only", async () => {
    const memory = new InMemoryLogRecordExporter();
    let fail = false;
    const exporter: LogRecordExporter = {
      export: (records, done) =>
        fail
          ? done({ code: 1, error: new Error("401 for xaat-secret") })
          : memory.export(records, done),
      shutdown: () => memory.shutdown(),
      forceFlush: () => memory.forceFlush(),
    };
    vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=staging");
    const sink = await startOtlpExport({ exporter });
    vi.unstubAllEnvs();
    expect(await startOtlpExport()).toBe(sink);

    // Security plan B6: a raw Drizzle message passed straight to the logger never leaves.
    logger.error({
      event: "admin.action_failed",
      unit: "log",
      error: { message: "Failed query: select … params: a@b.com" } as never,
      user_id: "u_1",
      ocr: { model: "google:gemini", tokens_in: 10 },
    });
    await flushEventSinks();
    const [exported] = memory.getFinishedLogRecords();
    expect(exported?.eventName).toBe("admin.action_failed");
    expect(exported?.severityNumber).toBe(17);
    expect(exported?.attributes).toMatchObject({ user_id: "u_1", "ocr.tokens_in": 10 });
    expect(exported?.resource.attributes).toMatchObject({
      "service.name": "web",
      "deployment.environment.name": "staging",
    });
    expect(JSON.stringify(exported?.attributes)).not.toContain("a@b.com");

    fail = true;
    vi.mocked(console.error).mockClear();
    logger.info({ event: "x" });
    await flushEventSinks();
    logger.info({ event: "y" });
    await flushEventSinks();
    const notices = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => JSON.parse(line as string))
      .filter((line) => line.event === "telemetry.export_failed");
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(notices)).not.toContain("xaat");

    await shutdownEventSinks();
  });
});
