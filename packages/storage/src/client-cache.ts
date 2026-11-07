import type { S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

/** Max cached clients: enough for env config plus a few BYO-storage workspaces. */
export const CLIENT_CACHE_MAX = 16;

/** A hash of the config, so the cache never holds the secret as a key. */
export const configKey = (parts: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** A minimal LRU: a Map's insertion order is the recency order. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(
    private readonly max: number,
    private readonly onEvict?: (value: V) => void,
  ) {}

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
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      const evicted = this.map.get(oldest) as V;
      this.map.delete(oldest);
      this.onEvict?.(evicted);
    }
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Evicted clients are destroyed so their sockets close. */
export const s3Clients = new LruCache<S3Client>(CLIENT_CACHE_MAX, (client) => client.destroy());
