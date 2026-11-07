import { describe, expect, it } from "vitest";
import { fitBatch } from "./batch-limit";
import { createBatchQueue, type BatchQueue, type UploadOutcome } from "./batch-queue";

const entries = (ids: string[]) => ids.map((id) => ({ id, payload: id }));

/** An uploader whose calls the test settles by hand. */
function manualUploader() {
  const calls: {
    id: string;
    mode: string;
    settle: (o: UploadOutcome) => void;
    progress: (f: number) => void;
  }[] = [];
  const upload = (id: string, mode: string, progress: (f: number) => void) =>
    new Promise<UploadOutcome>((settle) => calls.push({ id, mode, settle, progress }));
  return { calls, upload };
}

function fakeTimers() {
  let t = 0;
  const pending: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const entry = { at: t + ms, fn };
      pending.push(entry);
      return entry;
    },
    clearTimer: (handle: unknown) => {
      const i = pending.indexOf(handle as never);
      if (i >= 0) pending.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const entry of [...pending]) {
        if (entry.at <= t) {
          pending.splice(pending.indexOf(entry), 1);
          entry.fn();
        }
      }
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const statuses = (q: BatchQueue<string, string>) => q.getSnapshot().items.map((i) => i.status);

describe("batch queue", () => {
  it("never runs more than two uploads at once", async () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload });
    q.add(entries(["a", "b", "c", "d"]));
    q.start();
    expect(calls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(statuses(q)).toEqual(["uploading", "uploading", "waiting", "waiting"]);

    calls[0]!.settle({ ok: true, receiptId: "r-a" });
    await flush();
    expect(calls.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(q.getSnapshot().items[0]).toMatchObject({ status: "done", receiptId: "r-a" });

    for (const c of calls.slice(1)) c.settle({ ok: true, receiptId: `r-${c.id}` });
    await flush();
    calls[3]!.settle({ ok: true, receiptId: "r-d" });
    await flush();
    expect(statuses(q)).toEqual(["done", "done", "done", "done"]);
    expect(q.getSnapshot().running).toBe(false);
  });

  it("passes the mode given to start to the uploader", () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload });
    q.add(entries(["a"]));
    q.start("instant");
    expect(calls[0]).toMatchObject({ id: "a", mode: "instant" });
  });

  it("tells listeners when a run ends", async () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload });
    let settled = 0;
    q.onSettle(() => settled++);
    q.add(entries(["a", "b"]));
    q.start();
    calls[0]!.settle({ ok: true, receiptId: "r-a" });
    await flush();
    expect(settled).toBe(0);
    calls[1]!.settle({ ok: false, error: "nope" });
    await flush();
    expect(settled).toBe(1);
  });

  it("reports progress per item", () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload });
    q.add(entries(["a"]));
    q.start();
    calls[0]!.progress(0.4);
    expect(q.getSnapshot().items[0]!.progress).toBe(0.4);
  });

  it("marks a failed item, carries on with the rest, and retries on request", async () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload, concurrency: 1 });
    q.add(entries(["a", "b"]));
    q.start();
    calls[0]!.settle({ ok: false, error: "Server error", status: 502 });
    await flush();
    expect(q.getSnapshot().items[0]).toMatchObject({ status: "error", error: "Server error" });
    expect(calls[1]!.id).toBe("b");
    calls[1]!.settle({ ok: true, receiptId: "r-b" });
    await flush();

    q.retry("a");
    expect(calls[2]!.id).toBe("a");
    calls[2]!.settle({ ok: true, receiptId: "r-a" });
    await flush();
    expect(statuses(q)).toEqual(["done", "done"]);
  });

  it("treats a thrown uploader as a failed item", async () => {
    const q = createBatchQueue({ mode: "queued", upload: () => Promise.reject(new Error("boom")) });
    q.add(entries(["a"]));
    q.start();
    await flush();
    expect(q.getSnapshot().items[0]).toMatchObject({ status: "error" });
  });

  it("pauses for the per-minute limit, then resumes on its own", async () => {
    const { calls, upload } = manualUploader();
    const timers = fakeTimers();
    const q = createBatchQueue({ mode: "queued", upload, concurrency: 1, ...timers });
    q.add(entries(["a", "b"]));
    q.start();
    calls[0]!.settle({ ok: false, error: "Slow down", status: 429, retryAfterSeconds: 20 });
    await flush();
    expect(statuses(q)).toEqual(["waiting", "waiting"]);
    expect(q.getSnapshot()).toMatchObject({ pausedUntil: 20_000, running: true });
    expect(calls).toHaveLength(1);

    timers.advance(19_000);
    expect(calls).toHaveLength(1);
    timers.advance(1_000);
    expect(calls.map((c) => c.id)).toEqual(["a", "a"]);
    expect(q.getSnapshot().pausedUntil).toBeNull();
  });

  it("stops on the daily limit and keeps the rest waiting", async () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload, concurrency: 1 });
    q.add(entries(["a", "b", "c"]));
    q.start();
    calls[0]!.settle({ ok: true, receiptId: "r-a" });
    await flush();
    calls[1]!.settle({
      ok: false,
      error: "You've reached today's limit",
      status: 429,
      retryAfterSeconds: 6 * 3600,
    });
    await flush();
    expect(statuses(q)).toEqual(["done", "error", "waiting"]);
    expect(q.getSnapshot()).toMatchObject({
      stopped: "You've reached today's limit",
      running: false,
    });
    expect(calls).toHaveLength(2);
  });

  it("clears finished items and ignores results for removed ones", async () => {
    const { calls, upload } = manualUploader();
    const q = createBatchQueue({ mode: "queued", upload });
    q.add(entries(["a", "b"]));
    q.start();
    q.remove("b");
    calls[1]!.settle({ ok: true, receiptId: "r-b" });
    calls[0]!.settle({ ok: true, receiptId: "r-a" });
    await flush();
    expect(q.clearDone().map((i) => i.id)).toEqual(["a"]);
    expect(q.getSnapshot().items).toEqual([]);
  });
});

describe("fitBatch", () => {
  it("keeps everything that fits", () => {
    expect(fitBatch([1, 2], 3, 10)).toEqual({ kept: [1, 2], dropped: 0, notice: null });
  });

  it("keeps the first N and says how many were left out", () => {
    const r = fitBatch([1, 2, 3, 4], 8, 10);
    expect(r.kept).toEqual([1, 2]);
    expect(r.notice).toBe(
      "Added the first 2; 2 left out. Up to 10 receipts at a time. Upload these first, then add more.",
    );
  });

  it("refuses everything once the batch is full", () => {
    const r = fitBatch([1], 10, 10);
    expect(r.kept).toEqual([]);
    expect(r.notice).toBe("Up to 10 receipts at a time. Upload these first, then add more.");
  });
});
