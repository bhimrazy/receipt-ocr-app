/** Reads admin list state from the URL; anything unexpected falls back to the default. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const PAGE_SIZE = 25;

export function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim().slice(0, 200) : undefined;
}

export function pick<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const v = one(value);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function pageOf(value: string | string[] | undefined): number {
  const n = Number.parseInt(one(value) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}
