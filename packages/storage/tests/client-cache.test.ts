import { describe, expect, it } from "vitest";
import { CLIENT_CACHE_MAX, LruCache, s3Clients } from "../src/client-cache";
import { s3Client } from "../src/index";

const config = {
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  bucket: "b",
  accessKeyId: "AKID-test-id",
  secretAccessKey: "super-secret-access-key",
};

describe("s3Client cache", () => {
  it("reuses the client for the same config and builds a new one for a rotated secret", () => {
    expect(s3Client({ ...config })).toBe(s3Client({ ...config }));
    expect(s3Client({ ...config, secretAccessKey: "rotated-secret" })).not.toBe(s3Client(config));
  });

  it("keeps no credential in the cache keys, and stays bounded", () => {
    const secrets = Array.from({ length: CLIENT_CACHE_MAX + 5 }, (_, i) => `secret-${i}-xyz`);
    for (const s of secrets) s3Client({ ...config, secretAccessKey: s });
    const keys = s3Clients.keys();
    expect(keys.length).toBeLessThanOrEqual(CLIENT_CACHE_MAX);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      for (const s of [...secrets, config.accessKeyId]) expect(key).not.toContain(s);
    }
  });
});

describe("LruCache", () => {
  it("calls onEvict with the evicted value", () => {
    const evicted: number[] = [];
    const cache = new LruCache<number>(1, (v) => evicted.push(v));
    cache.set("a", 1);
    cache.set("b", 2);
    expect(evicted).toEqual([1]);
  });

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
