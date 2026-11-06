import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_POLL_MS, startBackoffPoll } from "./backoff-poll";
import { countsKey } from "./counts-key";

function setup(check: () => Promise<boolean>) {
  const state = { hidden: false, listener: () => {} };
  const onGiveUp = vi.fn();
  const unsubscribe = vi.fn();
  const stop = startBackoffPoll({
    check,
    onGiveUp,
    isHidden: () => state.hidden,
    onVisibilityChange: (listener) => {
      state.listener = listener;
      return unsubscribe;
    },
  });
  return { state, onGiveUp, unsubscribe, stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startBackoffPoll", () => {
  it("backs off 2s, 4s, 8s, then 15s", async () => {
    const check = vi.fn(async () => false);
    setup(check);
    const times: number[] = [];
    let last = 0;
    for (let ms = 0; ms <= 60_000; ms += 500) {
      const before = check.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500);
      if (check.mock.calls.length > before) {
        times.push(ms + 500 - last);
        last = ms + 500;
      }
    }
    expect(times).toEqual([2000, 2000, 2000, 4000, 4000, 4000, 8000, 8000, 8000, 15000]);
  });

  it("stops once check returns true", async () => {
    const check = vi.fn(async () => true);
    setup(check);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("keeps polling when check rejects", async () => {
    const check = vi.fn(async () => {
      throw new Error("offline");
    });
    setup(check);
    await vi.advanceTimersByTimeAsync(6000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("does nothing while hidden, and checks at once when visible again", async () => {
    const check = vi.fn(async () => false);
    const { state } = setup(check);
    state.hidden = true;
    state.listener();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).not.toHaveBeenCalled();
    state.hidden = false;
    state.listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("gives up once after the budget", async () => {
    const check = vi.fn(async () => false);
    const { onGiveUp } = setup(check);
    await vi.advanceTimersByTimeAsync(MAX_POLL_MS * 2);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    const calls = check.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MAX_POLL_MS);
    expect(check).toHaveBeenCalledTimes(calls);
  });

  it("cleans up on stop", async () => {
    const check = vi.fn(async () => false);
    const { stop, unsubscribe } = setup(check);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("countsKey", () => {
  it("differs when any count differs", () => {
    const base = { total: 3, needsReview: 1, failed: 0, inFlight: 2 };
    expect(countsKey(base)).toBe(countsKey({ ...base }));
    for (const field of Object.keys(base) as (keyof typeof base)[]) {
      expect(countsKey({ ...base, [field]: base[field] + 1 })).not.toBe(countsKey(base));
    }
  });
});
