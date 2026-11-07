import { createHash } from "node:crypto";

/** Max cached clients: enough for env config plus a few BYO-storage workspaces. */
export const CLIENT_CACHE_MAX = 16;

/** A hash of the config, so the cache never holds the secret as a key. */
export const configKey = (parts: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** A minimal LRU: a Map's insertion order is the recency order. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
