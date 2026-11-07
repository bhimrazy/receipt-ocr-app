import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, MAX_BATCH } from "./plans";
import { Db } from "./services";
import {
  ocrRoutingSchema,
  planTableSchema,
  providerAvailability,
  Settings,
  storedPlanTableSchema,
} from "./settings";

const policy = { workspaces: 3, receiptsPerDay: 100, receiptsPerMinute: 10, batchMax: 10 };

describe("planTableSchema", () => {
  it("accepts the defaults", () => {
    expect(planTableSchema.safeParse(DEFAULT_PLANS).success).toBe(true);
  });

  it("rejects a per-minute limit above the daily one", () => {
    const result = planTableSchema.safeParse({
      free: { ...policy, receiptsPerMinute: 101 },
      pro: policy,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/per-minute/);
  });

  it("rejects zero, fractions and a missing plan", () => {
    expect(
      planTableSchema.safeParse({ free: { ...policy, workspaces: 0 }, pro: policy }).success,
    ).toBe(false);
    expect(
      planTableSchema.safeParse({ free: { ...policy, receiptsPerDay: 1.5 }, pro: policy }).success,
    ).toBe(false);
    expect(planTableSchema.safeParse({ free: policy }).success).toBe(false);
  });
});

describe("planTableSchema batchMax", () => {
  it("defaults a row saved before batchMax existed to 10", () => {
    const old = { workspaces: 3, receiptsPerDay: 100, receiptsPerMinute: 10 };
    const result = planTableSchema.parse({ free: old, pro: old });
    expect(result.free.batchMax).toBe(10);
    expect(result.pro.batchMax).toBe(10);
  });

  it(`accepts 1 to ${MAX_BATCH} and rejects values outside that range`, () => {
    expect(MAX_BATCH).toBe(20);
    for (const batchMax of [1, 20]) {
      expect(
        planTableSchema.safeParse({ free: { ...policy, batchMax }, pro: policy }).success,
      ).toBe(true);
    }
    for (const batchMax of [0, 21, 50, 2.5]) {
      expect(
        planTableSchema.safeParse({ free: { ...policy, batchMax }, pro: policy }).success,
      ).toBe(false);
    }
  });
});

describe("storedPlanTableSchema", () => {
  it("clamps a stored batchMax over the cap and keeps the other limits", () => {
    const stored = {
      free: { ...policy, receiptsPerDay: 42, batchMax: 50 },
      pro: { ...policy, batchMax: 15 },
    };
    expect(planTableSchema.safeParse(stored).success).toBe(false);
    const read = storedPlanTableSchema.parse(stored);
    expect(read.free).toEqual({ ...policy, receiptsPerDay: 42, batchMax: MAX_BATCH });
    expect(read.pro.batchMax).toBe(15);
  });

  it("still rejects a batchMax that isn't a positive whole number", () => {
    for (const batchMax of [0, 2.5, "10"]) {
      expect(
        storedPlanTableSchema.safeParse({ free: { ...policy, batchMax }, pro: policy }).success,
      ).toBe(false);
    }
  });
});

describe("ocrRoutingSchema", () => {
  const step = { model: "google:gemini-3.8-flash", enabled: true };

  it("fills in the default step timeout", () => {
    const result = ocrRoutingSchema.parse({ chain: [step] });
    expect(result.chain[0]?.timeoutMs).toBe(30_000);
  });

  it("rejects models off the allowlist, duplicates and an empty chain", () => {
    expect(
      ocrRoutingSchema.safeParse({ chain: [{ ...step, model: "google:made-up" }] }).success,
    ).toBe(false);
    expect(ocrRoutingSchema.safeParse({ chain: [step, step] }).success).toBe(false);
    expect(ocrRoutingSchema.safeParse({ chain: [] }).success).toBe(false);
  });

  it("bounds the step timeout", () => {
    expect(ocrRoutingSchema.safeParse({ chain: [{ ...step, timeoutMs: 1_000 }] }).success).toBe(
      false,
    );
  });
});

/** Settings over a database with no saved rows; a write would fail the test. */
const settingsWith = (env: Record<string, string>, rows: unknown[] = []) => {
  const db = Layer.succeed(Db, {
    client: {
      transaction: () => Promise.reject(new Error("unexpected write")),
    } as never,
    use: () => Effect.succeed(rows as never),
  });
  return <A, E>(program: Effect.Effect<A, E, Settings>) =>
    Effect.runPromiseExit(
      program.pipe(
        Effect.provide(Settings.Live.pipe(Layer.provide(db))),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))),
      ),
    );
};

const actor = { actor: { id: "a", email: "a@example.com" } };

describe("providerAvailability", () => {
  const availability = (env: Record<string, string>) =>
    Effect.runPromise(
      providerAvailability.pipe(
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))),
      ),
    );

  it("marks each provider available from its own key env var", async () => {
    expect(await availability({ ANTHROPIC_API_KEY: "k" })).toEqual({
      google: false,
      anthropic: true,
      groq: false,
      openai: false,
      fixture: false,
    });
    expect(
      await availability({ GOOGLE_GENERATIVE_AI_API_KEY: "k", ANTHROPIC_API_KEY: " " }),
    ).toEqual({ google: true, anthropic: false, groq: false, openai: false, fixture: false });
    expect(await availability({ OCR_PROVIDER: "fixture" })).toEqual({
      google: false,
      anthropic: false,
      groq: false,
      openai: false,
      fixture: true,
    });
    expect(await availability({ GROQ_API_KEY: "k" })).toMatchObject({ groq: true, google: false });
    expect(await availability({ OPENAI_API_KEY: "k" })).toMatchObject({
      openai: true,
      groq: false,
    });
  });
});

describe("Settings", () => {
  it("defaults the chain to Claude Sonnet, then GEMINI_MODEL when it is on the allowlist", async () => {
    const run = settingsWith({ GEMINI_MODEL: "gemini-3.8-flash" });
    const exit = await run(Effect.flatMap(Settings, (s) => s.ocr));
    expect(Exit.isSuccess(exit) && exit.value.chain.map((s) => s.model)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "google:gemini-3.8-flash",
    ]);
  });

  it("falls back to an allowlisted model when GEMINI_MODEL isn't on the list", async () => {
    const run = settingsWith({ GEMINI_MODEL: "gemini-unlisted" });
    const exit = await run(Effect.flatMap(Settings, (s) => s.ocr));
    expect(Exit.isSuccess(exit) && exit.value.chain.map((s) => s.model)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "google:gemini-3.8-flash",
    ]);
  });

  it("ignores a saved chain naming a model that is no longer offered", async () => {
    const saved = {
      key: "ocr",
      value: { chain: [{ model: "google:gemini-3.7-flash", enabled: true, timeoutMs: 30_000 }] },
      updatedAt: new Date(),
      updatedBy: "a",
    };
    const run = settingsWith({ GEMINI_MODEL: "gemini-3.8-flash" }, [saved]);
    const exit = await run(Effect.flatMap(Settings, (s) => s.ocr));
    expect(Exit.isSuccess(exit) && exit.value.chain.map((s) => s.model)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "google:gemini-3.8-flash",
    ]);
  });

  it("saves batchMax and records the change in the audit log", async () => {
    const writes: { values: Record<string, unknown> }[] = [];
    const insert = () => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ values });
        return Object.assign(Promise.resolve(), { onConflictDoUpdate: () => Promise.resolve() });
      },
    });
    const select = () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) });
    const tx = { select, insert };
    const db = Layer.succeed(Db, {
      client: { transaction: (body: (t: unknown) => Promise<unknown>) => body(tx) } as never,
      use: () => Effect.succeed([] as never),
    });
    const table = { free: { ...policy, batchMax: 20 }, pro: { ...policy, batchMax: 15 } };
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(Settings, (s) => s.save("plans", table, actor)).pipe(
        Effect.provide(Settings.Live.pipe(Layer.provide(db))),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
      ),
    );
    expect(Exit.isSuccess(exit) && exit.value.next.free.batchMax).toBe(20);
    expect(Exit.isSuccess(exit) && exit.value.previous).toEqual(DEFAULT_PLANS);
    const [setting, audit] = writes;
    expect(setting?.values).toMatchObject({ key: "plans", value: table, updatedBy: "a" });
    expect(audit?.values).toMatchObject({
      actorId: "a",
      action: "settings.plans",
      targetId: "plans",
      metadata: { from: DEFAULT_PLANS, to: table },
    });
    expect(writes).toHaveLength(2);
  });

  it("reads a saved row with batchMax over the cap as the cap, keeping its other limits", async () => {
    const saved = {
      key: "plans",
      value: { free: { ...policy, receiptsPerDay: 42, batchMax: 50 }, pro: policy },
      updatedAt: new Date(),
      updatedBy: "a",
    };
    const run = settingsWith({}, [saved]);
    const exit = await run(Effect.flatMap(Settings, (s) => s.plans));
    expect(Exit.isSuccess(exit) && exit.value.free).toEqual({
      ...policy,
      receiptsPerDay: 42,
      batchMax: MAX_BATCH,
    });
  });

  it("refuses a batchMax over the cap without writing", async () => {
    const run = settingsWith({});
    const exit = await run(
      Effect.flatMap(Settings, (s) =>
        s.save("plans", { free: { ...policy, batchMax: MAX_BATCH + 1 }, pro: policy }, actor),
      ),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
  });

  it("refuses invalid plan limits before touching the database", async () => {
    const run = settingsWith({});
    const exit = await run(
      Effect.flatMap(Settings, (s) =>
        s.save("plans", { free: { ...policy, receiptsPerMinute: 500 }, pro: policy }, actor),
      ),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
  });

  it("refuses a chain with every model turned off", async () => {
    const run = settingsWith({ OCR_PROVIDER: "fixture" });
    const exit = await run(
      Effect.flatMap(Settings, (s) =>
        s.save("ocr", { chain: [{ model: "fixture", enabled: false }] }, actor),
      ),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      "Turn on at least one model",
    );
  });

  it("keeps Gemini as the default chain when an Anthropic key is set", async () => {
    const run = settingsWith({ ANTHROPIC_API_KEY: "k", GOOGLE_GENERATIVE_AI_API_KEY: "k" });
    const exit = await run(Effect.flatMap(Settings, (s) => s.ocr));
    expect(Exit.isSuccess(exit) && exit.value.chain.map((s) => s.model)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "google:gemini-3.8-flash",
    ]);
  });

  it("refuses to turn on a Claude model without ANTHROPIC_API_KEY", async () => {
    const run = settingsWith({ GOOGLE_GENERATIVE_AI_API_KEY: "k" });
    const exit = await run(
      Effect.flatMap(Settings, (s) =>
        s.save("ocr", { chain: [{ model: "anthropic:claude-haiku-5-5", enabled: true }] }, actor),
      ),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      "Claude Haiku 5.5 has no API key",
    );
  });

  it("refuses to turn on a model whose provider has no key", async () => {
    const run = settingsWith({});
    const exit = await run(
      Effect.flatMap(Settings, (s) =>
        s.save("ocr", { chain: [{ model: "google:gemini-3.8-flash", enabled: true }] }, actor),
      ),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("no API key");
  });
});
