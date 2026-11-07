import { ConfigProvider, Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAiProviders, checkStorage, storageHint } from "./connections";
import { NotConfigured, StorageError } from "./errors";
import { Storage } from "./services";

const KEY = "AIza-fake-secret-key-123";
const withEnv = (env: Record<string, string>) =>
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env))));

afterEach(() => vi.unstubAllGlobals());

describe("checkAiProviders", () => {
  it("reports a provider without a key as not-configured, without a request", async () => {
    const fetcher = vi.fn();
    const rows = await Effect.runPromise(
      checkAiProviders(["google:gemini-3.8-flash"], { fetch: fetcher }).pipe(withEnv({})),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ai:google", status: "not-configured" });
    expect(rows[0]!.hint).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks only the providers the models use, and never returns the key", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: `bad ${KEY}` } }), { status: 401 }),
    );
    const rows = await Effect.runPromise(
      checkAiProviders(["google:gemini-3.8-flash"], { fetch: fetcher as never }).pipe(
        withEnv({ GOOGLE_GENERATIVE_AI_API_KEY: KEY, ANTHROPIC_API_KEY: "other-key" }),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => [r.id, r.status])).toEqual([["ai:google", "invalid-key"]]);
    expect(rows[0]!.hint).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });

  it("checks every keyed provider when no models are given", async () => {
    const rows = await Effect.runPromise(checkAiProviders([]).pipe(withEnv({})));
    expect(rows.map((r) => r.id)).toEqual(["ai:google", "ai:anthropic"]);
  });
});

function memoryStorage(overrides: Partial<Layer.Layer.Success<typeof Storage.Live>> = {}) {
  const objects = new Map<string, Uint8Array>();
  const remove = vi.fn((keys: readonly string[]) =>
    Effect.sync(() => keys.forEach((k) => objects.delete(k))),
  );
  const service = {
    put: (key: string, body: Uint8Array) => Effect.sync(() => void objects.set(key, body)),
    get: (key: string) => Effect.succeed(objects.get(key)!),
    remove,
    signedUrl: () => Effect.succeed("x"),
    ...overrides,
  } as never;
  return { objects, remove, layer: Layer.succeed(Storage, service) };
}

describe("checkStorage", () => {
  const run = (layer: Layer.Layer<Storage>) =>
    Effect.runPromise(checkStorage.pipe(Effect.provide(layer)));

  it("writes, reads and deletes a probe under _health/", async () => {
    const mem = memoryStorage();
    const put = vi.fn((key: string, body: Uint8Array) =>
      Effect.sync(() => void mem.objects.set(key, body)),
    );
    const { layer } = memoryStorage({
      put,
      get: (key: string) => Effect.succeed(mem.objects.get(key)!),
      remove: mem.remove,
    } as never);
    const row = await run(layer);
    expect(row).toMatchObject({ id: "storage", status: "ok" });
    expect(put.mock.calls[0]![0]).toMatch(/^_health\/check-/);
    expect(mem.remove).toHaveBeenCalledTimes(1);
    expect(mem.objects.size).toBe(0);
  });

  it("is not-configured when storage env is missing", async () => {
    const { layer } = memoryStorage({
      put: () => Effect.fail(new NotConfigured({ message: "no" })),
    } as never);
    expect(await run(layer)).toMatchObject({ status: "not-configured", latencyMs: null });
  });

  it("names the failing stage, hides the error text and tries to clean up", async () => {
    const { layer, remove } = memoryStorage({
      get: () => Effect.fail(new StorageError({ message: `denied for ${KEY}`, cause: KEY })),
    } as never);
    const row = await run(layer);
    expect(row.status).toBe("failed");
    expect(row.hint).toBe(storageHint("failed", "read"));
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("fails when the object read back differs", async () => {
    const { layer } = memoryStorage({ get: () => Effect.succeed(new Uint8Array([1])) } as never);
    expect((await run(layer)).status).toBe("failed");
  });
});
