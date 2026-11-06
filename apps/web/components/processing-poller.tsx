"use client";

import type { ReceiptCounts } from "@receipt-ocr/core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReceiptStatus } from "@/lib/receipts";

/** Give up after this much polling time; background extraction should never take longer. */
const MAX_POLL_MS = 3 * 60 * 1000;
const BASE_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 15000;

/**
 * Calls `check` on a backed-off schedule until it returns true or the budget
 * runs out (then `onGiveUp`). Hidden tabs don't poll or spend budget; the
 * check runs again as soon as the tab is visible.
 */
function useBackoffPoll(enabled: boolean, check: () => Promise<boolean>, onGiveUp?: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(ms: number) {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      elapsed += ms;
      if (elapsed > MAX_POLL_MS) {
        stopped = true;
        onGiveUp?.();
        return;
      }
      timer = setTimeout(tick, ms);
    }

    async function tick() {
      if (stopped || document.hidden) return;
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

    function onVisibility() {
      if (document.hidden) clearTimeout(timer);
      else if (!stopped) void tick();
    }

    document.addEventListener("visibilitychange", onVisibility);
    schedule(BASE_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, check, onGiveUp]);
}

/**
 * While a receipt is still uploading/processing, polls its status endpoint and
 * refreshes the server-rendered page when the status changes.
 *
 * The interval backs off and the whole thing gives up after MAX_POLL_MS: the
 * previous version hammered the API every 2.5s forever if the background job
 * died, which is a request per user per 2.5s with nothing to show for it.
 */
export function ProcessingPoller({ id, status }: { id: string; status: ReceiptStatus }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  const check = useCallback(async () => {
    const res = await fetch(`/api/receipts/${id}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    if (!body.status || body.status === status) return false;
    router.refresh();
    return true;
  }, [id, status, router]);
  const giveUp = useCallback(() => setGaveUp(true), []);

  useBackoffPoll(status === "processing" || status === "uploaded", check, giveUp);

  if (!gaveUp) return null;

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
      role="status"
    >
      Still reading after a few minutes. Something may have gone wrong.
      <button
        className="min-h-11 rounded-md font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
        onClick={() => router.refresh()}
        type="button"
      >
        Check again
      </button>
    </div>
  );
}

const countsKey = (c: ReceiptCounts) => `${c.total}:${c.needsReview}:${c.failed}:${c.inFlight}`;

/**
 * Watches a server-rendered list while any row is still being read. Polls the
 * light counts endpoint and refreshes the page only when the counts differ from
 * the ones the page was rendered with, so a quiet queue costs no page renders.
 */
export function ListPoller({ active, counts }: { active: boolean; counts: ReceiptCounts }) {
  const router = useRouter();
  const rendered = countsKey(counts);

  const check = useCallback(async () => {
    const res = await fetch("/api/receipts/status");
    if (!res.ok) return false;
    if (countsKey((await res.json()) as ReceiptCounts) === rendered) return false;
    router.refresh();
    return true;
  }, [rendered, router]);

  useBackoffPoll(active, check);
  return null;
}
