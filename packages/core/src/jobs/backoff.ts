export type BackoffPolicy = {
  /** Delay before the first retry, before jitter. */
  baseMs: number;
  /** Longest delay, before jitter; also the most a provider's Retry-After can ask for. */
  capMs: number;
};

/**
 * Delay before retrying after failed attempt `attempt` (1-based): exponential
 * from `baseMs`, capped, with jitter in [50%, 100%] so a burst of failures
 * doesn't retry in lockstep. A provider's Retry-After is a floor.
 */
export function backoffMs(
  attempt: number,
  policy: BackoffPolicy,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  const jittered = exponential * (0.5 + random() / 2);
  const floor = retryAfterMs === undefined ? 0 : Math.min(retryAfterMs, policy.capMs);
  return Math.round(Math.max(floor, jittered));
}
