/** Give up after this much polling time; background extraction should never take longer. */
export const MAX_POLL_MS = 3 * 60 * 1000;
export const BASE_INTERVAL_MS = 2000;
export const MAX_INTERVAL_MS = 15000;

export type BackoffPollOptions = {
  /** Resolves true when polling is finished. A rejection counts as "not yet". */
  check: () => Promise<boolean>;
  onGiveUp?: () => void;
  isHidden: () => boolean;
  /** Subscribes to tab visibility changes; returns the unsubscribe. */
  onVisibilityChange: (listener: () => void) => () => void;
};

/**
 * Calls `check` on a backed-off schedule (2s x3, 4s x3, 8s x3, then 15s) until it
 * returns true or the time budget runs out. A hidden tab neither polls nor spends
 * budget, and checks again as soon as it is visible. Returns the stop function.
 */
export function startBackoffPoll({
  check,
  onGiveUp,
  isHidden,
  onVisibilityChange,
}: BackoffPollOptions): () => void {
  let stopped = false;
  let attempt = 0;
  let elapsed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(ms: number) {
    clearTimeout(timer);
    if (stopped || isHidden()) return;
    elapsed += ms;
    if (elapsed > MAX_POLL_MS) {
      stopped = true;
      onGiveUp?.();
      return;
    }
    timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (stopped || isHidden()) return;
    let done = false;
    try {
      done = await check();
    } catch {
      // transient network error: keep polling on the backed-off schedule
    }
    if (stopped) return;
    if (done) {
      stopped = true;
      return;
    }
    attempt += 1;
    schedule(Math.min(BASE_INTERVAL_MS * 2 ** Math.floor(attempt / 3), MAX_INTERVAL_MS));
  }

  const unsubscribe = onVisibilityChange(() => {
    if (isHidden()) clearTimeout(timer);
    else if (!stopped) void tick();
  });
  schedule(BASE_INTERVAL_MS);

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
  };
}
