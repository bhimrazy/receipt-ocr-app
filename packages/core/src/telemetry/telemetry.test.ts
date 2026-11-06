import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DbError, OcrError } from "../errors";
import { annotateEvent, withWideEvent } from "./current";
import { formatEvent, levelOf, WideEventLoggerLive } from "./logger";
import { errorFields, sanitize } from "./redact";
import { alwaysKeepReason, sampleDecision, samplingFromEnv } from "./sampling";
import type { WideEvent } from "./schema";

describe("sanitize (the allowlist)", () => {
  it("keeps schema fields and drops unknown keys, listing only their paths", () => {
    const { fields, dropped } = sanitize({
      event: "receipt.upload",
      user_id: "u_1",
      merchant: "Jane Doe Pharmacy",
      ocr: { model: "google:gemini-3.8-flash", tokens_in: 812, text: "TOTAL 9.50" },
    });
    expect(fields).toEqual({
      event: "receipt.upload",
      user_id: "u_1",
      ocr: { model: "google:gemini-3.8-flash", tokens_in: 812 },
    });
    expect(dropped).toEqual(["merchant", "ocr.text"]);
    expect(JSON.stringify({ fields, dropped })).not.toMatch(/Jane|9\.50/);
  });

  it("drops values of the wrong kind: free text, emails, non-finite numbers", () => {
    const { fields, dropped } = sanitize({
      event: "x",
      outcome: "it broke for jane@example.com",
      user_id: "jane@example.com",
      duration_ms: Number.NaN,
      attempt: 1.5,
      plan: "pro",
    });
    expect(fields).toEqual({ event: "x", plan: "pro" });
    expect(dropped).toEqual(["outcome", "user_id", "duration_ms", "attempt"]);
  });

  it("cuts the query string and hash off routes", () => {
    const { fields } = sanitize({ event: "x", route: "/app/history?q=pharmacy#top" });
    expect(fields.route).toBe("/app/history");
  });

  it("filters map entries and list items by their own schema", () => {
    const { fields, dropped } = sanitize({
      event: "x",
      timings_ms: { "storage.put": 12, "db.insert": "slow" },
      flags: { mode: "instant", "has space": true },
      violations: [{ directive: "img-src", blocked: "x.example", url: "https://x.example/?t=1" }],
    });
    expect(fields).toMatchObject({
      timings_ms: { "storage.put": 12 },
      flags: { mode: "instant" },
      violations: [{ directive: "img-src", blocked: "x.example" }],
    });
    expect(dropped).toEqual(["timings_ms.db.insert", "flags.?", "violations[].url"]);
  });

  it("treats null and undefined as absent, not dropped", () => {
    expect(sanitize({ event: "x", receipt_id: null, job_id: undefined })).toEqual({
      fields: { event: "x" },
      dropped: [],
    });
  });
});

describe("errorFields", () => {
  it("describes a typed error by tag, kind, cause class and SQLSTATE, never its message", () => {
    const cause = Object.assign(new Error("params: jane@example.com"), { code: "23505" });
    expect(errorFields(new DbError({ message: "insert failed: Jane", cause }))).toEqual({
      type: "DbError",
      kind: undefined,
      class: "Error",
      code: "23505",
    });
    const ocr = new OcrError({ message: "model said TOTAL 9.50", kind: "timeout", attempts: [] });
    expect(errorFields(ocr)).toMatchObject({ type: "OcrError", kind: "timeout" });
  });

  it("keeps only the class of a plain error", () => {
    expect(errorFields(new TypeError("receipt text"))).toEqual({
      class: "TypeError",
      code: undefined,
    });
    expect(errorFields("a string")).toEqual({ class: "string", code: undefined });
  });
});

describe("sampling", () => {
  const config = { rate: 0.1, slowMs: 1000 };
  const fast: WideEvent = { event: "page.render", duration_ms: 40, outcome: "ok" };

  it("keeps errors, slow work and model calls at any rate", () => {
    expect(alwaysKeepReason({ ...fast, status_code: 500 }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, status_code: 401 }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, error: { type: "Defect" } }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, level: "error" }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, duration_ms: 1000 }, config)).toBe("slow");
    expect(alwaysKeepReason({ ...fast, ocr: { calls: 1 } }, config)).toBe("model_call");
    expect(alwaysKeepReason(fast, config)).toBeNull();
    expect(sampleDecision({ ...fast, status_code: 500 }, true, config, () => 0.99)).toEqual({
      keep: true,
      rate: 1,
    });
  });

  it("samples only routine, fast, successful events", () => {
    expect(sampleDecision(fast, true, config, () => 0.05)).toEqual({ keep: true, rate: 0.1 });
    expect(sampleDecision(fast, true, config, () => 0.5)).toEqual({ keep: false, rate: 0.1 });
    expect(sampleDecision(fast, false, config, () => 0.99)).toEqual({ keep: true, rate: 1 });
  });

  it("reads LOG_SAMPLE_RATE and LOG_SLOW_MS, keeping everything by default", () => {
    expect(samplingFromEnv({})).toEqual({ rate: 1, slowMs: 1000 });
    expect(samplingFromEnv({ LOG_SAMPLE_RATE: "0.1", LOG_SLOW_MS: "500" })).toEqual({
      rate: 0.1,
      slowMs: 500,
    });
    expect(samplingFromEnv({ LOG_SAMPLE_RATE: "7" }).rate).toBe(1);
    expect(samplingFromEnv({ LOG_SAMPLE_RATE: "nope" }).rate).toBe(1);
  });
});

describe("formatEvent", () => {
  beforeEach(() => vi.stubEnv("LOG_SAMPLE_RATE", "0.1"));
  afterEach(() => vi.unstubAllEnvs());

  it("writes stable leading keys, an ISO timestamp and the deployment fields", () => {
    const out = formatEvent({ event: "job.attempt", outcome: "dead", job_id: "j1", note: "x" });
    expect(out?.level).toBe("error");
    const line = JSON.parse(out!.line);
    expect(Object.keys(line).slice(0, 8)).toEqual([
      "timestamp",
      "level",
      "event",
      "service",
      "version",
      "env",
      "region",
      "instance",
    ]);
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
    expect(line).toMatchObject({ event: "job.attempt", job_id: "j1", dropped_fields: ["note"] });
  });

  it("marks sampled routine lines with their rate and drops the rest", () => {
    const routine: WideEvent = { event: "page.render", duration_ms: 5 };
    expect(formatEvent(routine, { routine: true }, () => 0.5)).toBeNull();
    const kept = formatEvent(routine, { routine: true }, () => 0.01);
    expect(JSON.parse(kept!.line).sample_rate).toBe(0.1);
  });

  it("derives the level from the outcome unless forced", () => {
    expect(levelOf({ event: "x", status_code: 503 })).toBe("error");
    expect(levelOf({ event: "x", outcome: "lost" })).toBe("error");
    expect(levelOf({ event: "x", outcome: "retry" })).toBe("info");
    expect(levelOf({ event: "x", outcome: "ok", level: "error" })).toBe("error");
  });
});

describe("annotateEvent and the Effect logger", () => {
  const runtime = ManagedRuntime.make(Layer.mergeAll(WideEventLoggerLive));
  afterEach(() => vi.restoreAllMocks());

  it("lets deep code add to the current event, and folds Effect.log calls into it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const event: WideEvent = { event: "receipt.upload", ocr: { model: "m" } };
    const deep = Effect.gen(function* () {
      yield* annotateEvent({ ocr: { tokens_in: 10 }, timings_ms: { "db.insert": 3 } });
      yield* Effect.fork(annotateEvent({ round: 2 })).pipe(Effect.flatMap((f) => f.await));
      yield* Effect.logError("receipt.calls_not_recorded", { error: "Jane Doe" });
    });
    await runtime.runPromise(deep.pipe(withWideEvent(event)));
    expect(event).toMatchObject({
      ocr: { model: "m", tokens_in: 10 },
      timings_ms: { "db.insert": 3 },
      round: 2,
      notices: ["receipt.calls_not_recorded"],
      level: "error",
    });
    // Folded into the event: no line of its own.
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("is a no-op outside an event, where Effect.log becomes a scrubbed standalone line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runtime.runPromise(
      annotateEvent({ round: 1 }).pipe(
        Effect.zipRight(
          Effect.logError("settings.load_failed", { error: { type: "DbError" }, message: "Jane" }),
        ),
      ),
    );
    expect(error).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(error.mock.calls[0]![0]));
    expect(line).toMatchObject({
      level: "error",
      event: "settings.load_failed",
      unit: "log",
      error: { type: "DbError" },
      dropped_fields: ["message"],
    });
    expect(String(error.mock.calls[0]![0])).not.toContain("Jane");
  });
});
