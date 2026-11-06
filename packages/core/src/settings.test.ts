import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "./plans";
import { Db } from "./services";
import { ocrRoutingSchema, planTableSchema, Settings } from "./settings";

const policy = { workspaces: 3, receiptsPerDay: 100, receiptsPerMinute: 10 };

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
const settingsWith = (env: Record<string, string>) => {
  const db = Layer.succeed(Db, {
    client: {
      transaction: () => Promise.reject(new Error("unexpected write")),
    } as never,
    use: () => Effect.succeed([] as never),
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

describe("Settings", () => {
  it("defaults the chain to GEMINI_MODEL when it is on the allowlist", async () => {
    const run = settingsWith({ GEMINI_MODEL: "gemini-3.8-flash" });
    const exit = await run(Effect.flatMap(Settings, (s) => s.ocr));
    expect(Exit.isSuccess(exit) && exit.value.chain.map((s) => s.model)).toEqual([
      "google:gemini-3.8-flash",
    ]);
  });

  it("falls back to an allowlisted model when GEMINI_MODEL isn't on the list", async () => {
    const run = settingsWith({ GEMINI_MODEL: "gemini-unlisted" });
    const exit = await run(Effect.flatMap(Settings, (s) => s.ocr));
    expect(Exit.isSuccess(exit) && exit.value.chain.map((s) => s.model)).toEqual([
      "google:gemini-3.8-flash",
    ]);
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
