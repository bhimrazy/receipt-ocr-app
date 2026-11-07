import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DbError, OcrError } from "../errors";
import { annotateEvent, withWideEvent } from "./current";
import { formatEvent, levelOf, logger, WideEventLoggerLive } from "./logger";
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
      redacted: 0,
    });
  });
});

describe("sanitize against adversarial input", () => {
  const EMAIL = "jane.doe@example.com";
  const leaks = (value: unknown) => {
    const text = JSON.stringify(value);
    return ["jane", "example.com", "Smith", "9.50", "secret", "Bearer", "eyJ"].filter((s) =>
      text.includes(s),
    );
  };

  it("drops free text at every depth: nested groups, unknown nested keys, maps and lists", () => {
    const out = sanitize({
      event: "receipt.upload",
      error: {
        type: "DbError",
        message: `Failed query: insert ... params: ${EMAIL},Dr Smith Clinic`,
        stack: `Error: ${EMAIL}\n    at x`,
        cause: { message: EMAIL, code: "23505" },
        kind: { nested: EMAIL },
      },
      ocr: { model: "m", raw: { text: "TOTAL 9.50" }, items: [{ name: "Dr Smith" }] },
      queue: { kind: "receipt.extract", payload: { receiptId: "r1", note: EMAIL } },
      flags: { [EMAIL]: true, merchant: "Dr Smith Clinic", ok: true },
      counts: { "Dr Smith": 1, items: 2 },
      timings_ms: { "ai.extract": 10, nested: { deeper: 1 } },
      notices: ["receipt.calls_not_recorded", EMAIL, "TOTAL 9.50", { x: EMAIL }],
      violations: [{ directive: "img-src", blocked: EMAIL }, EMAIL, [EMAIL]],
      file: { size_bytes: 10, media_type: "image/jpeg", name: "jane-doe-receipt.jpg" },
    });
    expect(leaks(out)).toEqual([]);
    expect(out.fields).toMatchObject({
      error: { type: "DbError" },
      ocr: { model: "m" },
      queue: { kind: "receipt.extract" },
      flags: { ok: true },
      counts: { items: 2 },
      timings_ms: { "ai.extract": 10 },
      notices: ["receipt.calls_not_recorded"],
      violations: [{ directive: "img-src" }],
      file: { size_bytes: 10, media_type: "image/jpeg" },
    });
  });

  it("drops emails, IPs, tokens, cookies and URLs placed in id, token and route fields", () => {
    const out = sanitize({
      event: "x",
      user_id: EMAIL,
      organization_id: "Dr Smith Clinic",
      request_id: "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
      outcome: "failed for jane.doe@example.com",
      plan: "a b",
      route: `/app/receipts/${EMAIL}?token=secret`,
      action: "session_token=secret; Path=/",
      kind: "https://x.example.com/?code=secret",
      worker: "10.0.0.1, 192.168.1.1",
      ip: "203.0.113.7",
      cookie: "__Secure-better-auth.session_token=secret",
      authorization: "Bearer secret",
      user_agent: "Mozilla/5.0",
      prompt: "Extract the receipt",
      text: "TOTAL 9.50",
    });
    expect(out.fields).toEqual({ event: "x" });
    expect(leaks(out)).toEqual([]);
    expect(out.dropped).toEqual(expect.arrayContaining(["ip", "cookie", "authorization"]));
  });

  it("refuses objects that aren't plain: class instances, errors, prototype tricks", () => {
    const error = Object.assign(new Error(EMAIL), { type: "DbError" });
    const proto = JSON.parse(`{"__proto__": {"user_id": "u1"}, "event": "x"}`);
    const out = sanitize({
      ...proto,
      error,
      ocr: new Map([["model", EMAIL]]),
      timings_ms: Object.assign(Object.create({ inherited: 1 }), { own: 2 }),
    });
    expect(leaks(out)).toEqual([]);
    expect(out.fields).toEqual({ event: "x" });
    expect(Object.prototype).not.toHaveProperty("user_id");
  });

  it("caps lists, maps and the dropped-path list", () => {
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    const out = sanitize({
      event: "x",
      counts: many,
      notices: Array.from({ length: 100 }, (_, i) => `n${i}`),
      ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`junk${i}`, EMAIL])),
    });
    expect(Object.keys(out.fields.counts as object)).toHaveLength(32);
    expect(out.fields.notices).toHaveLength(20);
    expect(out.dropped).toHaveLength(20);
  });

  it("errorFields never carries an email from a message, a cause chain or an error name", () => {
    const named = new Error(`boom ${EMAIL}`);
    named.name = EMAIL;
    const chain = new DbError({
      message: `Failed query: select ... params: ${EMAIL}`,
      cause: new Error(`wrapped ${EMAIL}`, { cause: new Error(EMAIL) }),
    });
    const ocr = new OcrError({
      message: `Type validation failed: Value: {"merchant":"Dr Smith Clinic","total":9.50}`,
      kind: "invalid-output",
      attempts: [],
    });
    for (const error of [named, chain, ocr, { message: EMAIL }, EMAIL]) {
      const fields = errorFields(error);
      expect(leaks(fields)).toEqual([]);
      expect(leaks(formatEvent({ event: "x", error: fields })!.line)).toEqual([]);
    }
  });

  it("formatEvent scrubs what callers pass straight to logger.error", () => {
    const line = formatEvent({
      event: "admin.action_failed",
      action: "user.ban",
      error: { message: EMAIL, stack: "at x", type: "Error" } as never,
      message: String(new Error(`params: ${EMAIL}`)),
      email: EMAIL,
    })!.line;
    expect(leaks(line)).toEqual([]);
    expect(JSON.parse(line)).toMatchObject({
      action: "user.ban",
      error: { type: "Error" },
      dropped_fields: ["error.message", "error.stack", "message", "email"],
    });
  });
});

describe("sanitize: ids, prototype keys and failures", () => {
  const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("accepts only UUIDs for receipt, group, job and request ids; Better Auth ids stay opaque", () => {
    const { fields, dropped } = sanitize({
      event: "x",
      receipt_id: UUID,
      group_id: "Groceries",
      job_id: "j1",
      request_id: `${UUID}x`,
      user_id: "aBc123XyZ",
      organization_id: "org_9f8e",
    });
    expect(fields).toEqual({
      event: "x",
      receipt_id: UUID,
      user_id: "aBc123XyZ",
      organization_id: "org_9f8e",
    });
    expect(dropped).toEqual(["group_id", "job_id", "request_id"]);
  });

  it("treats constructor, toString and __proto__ as unknown keys, at the top and in groups and maps", () => {
    const input = JSON.parse(
      `{"event":"x","constructor":"a","toString":"b","__proto__":{"user_id":"u"},` +
        `"ocr":{"constructor":1,"hasOwnProperty":2,"model":"m"},` +
        `"counts":{"__proto__":1,"constructor":2,"prototype":3,"n":4},` +
        `"flags":{"__proto__":"x","ok":true}}`,
    );
    const { fields, dropped } = sanitize(input);
    expect(fields).toEqual({
      event: "x",
      ocr: { model: "m" },
      counts: { n: 4 },
      flags: { ok: true },
    });
    expect(Object.getPrototypeOf(fields.counts)).toBe(Object.prototype);
    expect(dropped).toEqual(
      expect.arrayContaining(["constructor", "toString", "__proto__", "ocr.constructor"]),
    );
  });

  it("errorFields survives a throwing _tag getter", () => {
    const hostile = {
      get _tag(): string {
        throw new Error("jane@example.com");
      },
    };
    expect(errorFields(hostile)).toEqual({ type: "Unreadable" });
    const proxy = new Proxy(
      {},
      {
        has: () => {
          throw new Error("x");
        },
      },
    );
    expect(errorFields(proxy)).toEqual({ type: "Unreadable" });
  });

  it("logger.emit never throws, even for an event whose getters throw", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = {
      event: "x",
      get user_id(): string {
        throw new Error("boom");
      },
    };
    expect(() => logger.emit(event)).not.toThrow();
    expect(String(error.mock.calls[0]?.[0])).toContain('"event":"log.failed"');
    error.mockRestore();
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
    expect(alwaysKeepReason({ ...fast, status_code: 403 }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, error: { type: "Defect" } }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, level: "error" }, config)).toBe("error");
    expect(alwaysKeepReason({ ...fast, duration_ms: 1000 }, config)).toBe("slow");
    expect(alwaysKeepReason({ ...fast, ocr: { calls: 1 } }, config)).toBe("model_call");
    expect(alwaysKeepReason(fast, config)).toBeNull();
    // Floods and signed-out polls are routine; real errors are not.
    expect(alwaysKeepReason({ ...fast, status_code: 429 }, config)).toBeNull();
    expect(alwaysKeepReason({ ...fast, status_code: 401 }, config)).toBeNull();
    expect(alwaysKeepReason({ ...fast, status_code: 429, error: { type: "X" } }, config)).toBe(
      "error",
    );
    expect(sampleDecision({ ...fast, status_code: 429 }, true, config, () => 0.5)).toEqual({
      keep: false,
      rate: 0.1,
    });
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
    // Floored, so routine 401s and 429s are never erased entirely.
    expect(samplingFromEnv({ LOG_SAMPLE_RATE: "0" }).rate).toBe(0.01);
    expect(samplingFromEnv({ LOG_SAMPLE_RATE: "-1" }).rate).toBe(0.01);
  });
});

describe("formatEvent", () => {
  beforeEach(() => vi.stubEnv("LOG_SAMPLE_RATE", "0.1"));
  afterEach(() => vi.unstubAllEnvs());

  it("writes stable leading keys, an ISO timestamp and the deployment fields", () => {
    const out = formatEvent({
      event: "job.attempt",
      outcome: "dead",
      job_id: "00000000-0000-4000-8000-0000000000a1",
      note: "x",
    });
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
    expect(line).toMatchObject({
      event: "job.attempt",
      job_id: "00000000-0000-4000-8000-0000000000a1",
      dropped_fields: ["note"],
    });
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

describe("secret denylist", () => {
  // Built at runtime so the literals don't trip secret scanners.
  const rep = (c: string, n: number) => c.repeat(n);
  const SECRETS: Record<string, string> = {
    gemini: "AIza" + rep("a", 35),
    anthropic: "sk-ant-api03-" + rep("x", 40),
    resend: "re_" + rep("A1", 14),
    hex32: rep("ab", 16),
    hex64: rep("0f", 32),
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl",
    postgres: "postgresql://user:hunter2secret@db.example.com:5432/postgres",
    bearer: "Bearer abc123def456",
    githubClassic: "ghp_" + rep("Z9", 20),
    githubPat: "github_pat_" + rep("Q", 30),
    vercel: "vcp_" + rep("k", 30),
    pem: "-----BEGIN PRIVATE KEY-----",
    hex40: rep("1f", 20),
    googleOauth: "GOCSPX-" + rep("a1", 14),
    awsKeyId: "AKIA" + rep("Q", 16),
    prefixed: "x_sk-ant-api03-" + rep("x", 40),
  };

  const legitimate = [
    "3f1d7c0e-8b1a-4c53-9a3e-0b6f3f1d7c0e",
    "V1StGXR8_Z5jdHi6B-myT",
    "cjld2cjxh0000qzrmn831i7rn",
    "ocr.extract",
    "google:gemini-3.8-flash",
    "anthropic:claude-sonnet-5-5",
    "receipt.upload",
    "23505",
    "retry_exhausted",
    "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6", // 32-char Better Auth id
  ];

  // Shapes with spaces, `@` or `-----` never fit id/token, so they are dropped instead.
  const FITS = new Set(
    Object.keys(SECRETS).filter((n) => !["postgres", "bearer", "pem"].includes(n)),
  );

  it.each(Object.entries(SECRETS))(
    "keeps a %s shape out of id and token fields",
    (name, secret) => {
      const { fields, redacted, dropped } = sanitize({
        event: "x",
        outcome: secret,
        user_id: secret,
        flags: { mode: secret },
        route: `/${secret}?q=1`,
      });
      expect(JSON.stringify({ fields, dropped })).not.toContain(secret);
      if (FITS.has(name)) {
        expect(fields.user_id).toBe("[redacted:secret]");
        expect(redacted).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("does not replace a route whole for a secret in its query string", () => {
    const { fields, redacted } = sanitize({
      event: "x",
      route: `/app/history?k=${SECRETS.gemini}`,
    });
    expect(fields.route).toBe("/app/history");
    expect(redacted).toBe(0);
  });

  it.each(["eyJ", "postgres://a:", "AIza", "Bearer ", "sk-", "re_", "ghp_", "-----BEGIN "])(
    "handles 100 KB of %s repeated in well under 50 ms",
    (unit) => {
      const big = unit.repeat(Math.ceil(100_000 / unit.length));
      const start = performance.now();
      sanitize({ event: "x", user_id: big, outcome: big, route: big, flags: { mode: big } });
      expect(performance.now() - start).toBeLessThan(50);
    },
  );

  it("is linear on accepted near-miss values too", () => {
    const near = "eyJ".repeat(33);
    const start = performance.now();
    for (let i = 0; i < 200; i++) sanitize({ event: "x", user_id: near, outcome: near });
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("keeps legitimate ids and codes", () => {
    for (const value of legitimate) {
      const id = sanitize({ event: "x", user_id: value, kind: value.length > 100 ? "x" : "k" });
      expect(id.redacted, value).toBe(0);
    }
    expect(sanitize({ event: "x", receipt_id: legitimate[0] }).fields.receipt_id).toBe(
      legitimate[0],
    );
  });

  it("never names a secret-shaped map key in dropped_fields", () => {
    const { fields, dropped } = sanitize({ event: "x", flags: { [SECRETS.gemini!]: true } });
    expect(JSON.stringify({ fields, dropped })).not.toContain("AIza");
  });

  describe("canary through the real logger", () => {
    let info: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      info = vi.spyOn(console, "info").mockImplementation(() => {});
      error = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it("writes no secret shape and counts the attempts", () => {
      const secrets = Object.values(SECRETS);
      for (const secret of secrets) {
        logger.emit({
          event: "canary",
          user_id: secret,
          outcome: secret,
          kind: secret,
          error: { type: secret, code: secret },
          flags: { [secret]: secret },
        } as never);
      }
      const lines = [...info.mock.calls, ...error.mock.calls].map((c: unknown[]) => String(c[0]));
      expect(lines).toHaveLength(secrets.length);
      for (const line of lines) {
        for (const secret of secrets) expect(line).not.toContain(secret);
      }
    });

    it("also holds for fields added through annotateEvent", async () => {
      const runtime = ManagedRuntime.make(Layer.mergeAll(WideEventLoggerLive));
      const secrets = Object.values(SECRETS);
      for (const secret of secrets) {
        const event: WideEvent = { event: "canary" };
        const deep = annotateEvent({ error: { type: secret, kind: secret }, user_id: secret });
        await runtime.runPromise(deep.pipe(withWideEvent(event)));
        logger.info(event as never);
      }
      const lines = info.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(lines).toHaveLength(secrets.length);
      for (const line of lines) for (const secret of secrets) expect(line).not.toContain(secret);
    });
  });
});
