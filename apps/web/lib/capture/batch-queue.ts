/**
 * Uploads a batch with limited concurrency, per-item progress and retry. Framework-free:
 * the panel subscribes to snapshots. A 429 for the per-minute limit pauses the queue until
 * `Retry-After` and then resumes on its own; a 429 with a long wait (the daily limit) stops
 * it, leaving the rest waiting so nothing is lost.
 */

export type UploadOutcome =
  | { ok: true; receiptId: string }
  | { ok: false; error: string; status?: number; retryAfterSeconds?: number };

export type ItemStatus = "waiting" | "uploading" | "done" | "error";
export type QueueItem<T = unknown> = {
  id: string;
  /** What the uploader sends (the file). */
  payload: T;
  status: ItemStatus;
  /** 0..1 while uploading. */
  progress: number;
  error?: string;
  receiptId?: string;
};

export type QueueSnapshot<T = unknown> = {
  items: QueueItem<T>[];
  running: boolean;
  /** Set while paused for the per-minute limit: when uploads resume (epoch ms). */
  pausedUntil: number | null;
  /** Why the queue stopped early (the daily limit); cleared by `start()`. */
  stopped: string | null;
};

/** `mode` is whatever the last `start()` was given (for example instant or queued). */
export type Uploader<T, M> = (
  payload: T,
  mode: M,
  onProgress: (fraction: number) => void,
) => Promise<UploadOutcome>;

/** Waits up to this long on a per-minute 429 before giving up and stopping instead. */
export const MAX_AUTO_WAIT_SECONDS = 90;
export const DEFAULT_CONCURRENCY = 2;

export function createBatchQueue<T, M>({
  upload,
  mode: initialMode,
  concurrency = DEFAULT_CONCURRENCY,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now = () => Date.now(),
}: {
  upload: Uploader<T, M>;
  /** The mode until `start()` sets one. */
  mode: M;
  concurrency?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}) {
  let items: QueueItem<T>[] = [];
  let mode = initialMode;
  let active = 0;
  let wanted = false;
  let pausedUntil: number | null = null;
  let stopped: string | null = null;
  let timer: unknown = null;
  let snapshot: QueueSnapshot<T> = { items, running: false, pausedUntil, stopped };
  const listeners = new Set<() => void>();

  const settleListeners = new Set<() => void>();

  function emit() {
    const wasRunning = snapshot.running;
    snapshot = {
      items,
      running: active > 0 || (wanted && pausedUntil !== null),
      pausedUntil,
      stopped,
    };
    for (const l of listeners) l();
    if (wasRunning && !snapshot.running) for (const l of settleListeners) l();
  }

  function patch(id: string, change: Partial<QueueItem<T>>) {
    items = items.map((item) => (item.id === id ? { ...item, ...change } : item));
  }

  function pump() {
    while (wanted && pausedUntil === null && active < concurrency) {
      const next = items.find((item) => item.status === "waiting");
      if (!next) break;
      active++;
      patch(next.id, { status: "uploading", progress: 0, error: undefined });
      void run(next.id, next.payload);
    }
    if (active === 0 && pausedUntil === null) wanted = false;
    emit();
  }

  async function run(id: string, payload: T) {
    let outcome: UploadOutcome;
    try {
      outcome = await upload(payload, mode, (fraction) => {
        patch(id, { progress: Math.max(0, Math.min(1, fraction)) });
        emit();
      });
    } catch {
      outcome = { ok: false, error: "The upload failed. Try again." };
    }
    active--;
    if (!items.some((item) => item.id === id)) return pump();
    if (outcome.ok) {
      patch(id, { status: "done", progress: 1, receiptId: outcome.receiptId });
    } else if (outcome.status === 429) {
      const wait = outcome.retryAfterSeconds ?? MAX_AUTO_WAIT_SECONDS + 1;
      if (wait <= MAX_AUTO_WAIT_SECONDS) {
        // Per-minute limit: this one goes back in line and everything waits it out.
        patch(id, { status: "waiting", progress: 0 });
        pause(wait);
      } else {
        patch(id, { status: "error", progress: 0, error: outcome.error });
        stopped = outcome.error;
        wanted = false;
      }
    } else {
      patch(id, { status: "error", progress: 0, error: outcome.error });
    }
    pump();
  }

  function pause(seconds: number) {
    const until = now() + seconds * 1000;
    if (pausedUntil !== null && pausedUntil >= until) return;
    if (timer !== null) clearTimer(timer);
    pausedUntil = until;
    timer = setTimer(() => {
      timer = null;
      pausedUntil = null;
      pump();
    }, seconds * 1000);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    /** Calls `listener` each time a run ends (everything finished, failed or stopped). */
    onSettle(listener: () => void) {
      settleListeners.add(listener);
      return () => {
        settleListeners.delete(listener);
      };
    },
    /** The mode of the current or last run. */
    getMode: () => mode,
    add(entries: { id: string; payload: T }[]) {
      items = [
        ...items,
        ...entries.map(({ id, payload }) => ({
          id,
          payload,
          status: "waiting" as const,
          progress: 0,
        })),
      ];
      emit();
    },
    remove(id: string) {
      items = items.filter((item) => item.id !== id);
      emit();
    },
    /** Uploads everything waiting or failed, in `nextMode`. */
    start(nextMode: M = mode) {
      mode = nextMode;
      items = items.map((item) =>
        item.status === "error" ? { ...item, status: "waiting" as const, error: undefined } : item,
      );
      stopped = null;
      wanted = true;
      pump();
    },
    retry(id: string) {
      patch(id, { status: "waiting", error: undefined, progress: 0 });
      stopped = null;
      wanted = true;
      pump();
    },
    /** Drops finished items; returns them so the caller can release their previews. */
    clearDone() {
      const done = items.filter((item) => item.status === "done");
      items = items.filter((item) => item.status !== "done");
      emit();
      return done;
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      wanted = false;
      listeners.clear();
      settleListeners.clear();
    },
  };
}

export type BatchQueue<T, M> = ReturnType<typeof createBatchQueue<T, M>>;
