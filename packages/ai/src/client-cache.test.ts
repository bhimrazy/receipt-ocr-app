import { describe, expect, it } from "vitest";
import { CLIENT_CACHE_MAX, LruCache } from "./client-cache";
import { registryCacheKeys, registryFor } from "./extract";

describe("provider registry cache", () => {
  it("reuses the registry for the same keys and builds a new one for another key", () => {
    const keys = { google: "AIza-test-secret-one", anthropic: "sk-ant-test-secret-one" };
    expect(registryFor({ ...keys })).toBe(registryFor({ ...keys }));
    expect(registryFor({ ...keys, google: "AIza-test-secret-two" })).not.toBe(registryFor(keys));
  });

  it("keeps no key, or part of one, in the cache keys, and stays bounded", () => {
    const secrets = Array.from({ length: CLIENT_CACHE_MAX + 5 }, (_, i) => `secret-key-${i}-xyz`);
    for (const s of secrets) registryFor({ google: s, anthropic: s });
    const cacheKeys = registryCacheKeys();
    expect(cacheKeys.length).toBeLessThanOrEqual(CLIENT_CACHE_MAX);
    for (const key of cacheKeys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      for (const s of secrets) expect(key).not.toContain(s);
    }
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry past the max", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.keys()).toEqual(["a", "c"]);
  });
});
