"use client";

import type { ReceiptCounts } from "@receipt-ocr/core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { countsKey } from "@/lib/counts-key";
import { startBackoffPoll } from "@/lib/backoff-poll";
import type { ReceiptStatus } from "@/lib/receipts";

function useBackoffPoll(enabled: boolean, check: () => Promise<boolean>, onGiveUp?: () => void) {
  useEffect(() => {
    if (!enabled) return;
    return startBackoffPoll({
      check,
      onGiveUp,
      isHidden: () => document.hidden,
      onVisibilityChange: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
    });
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
  // Through the status endpoint first: a poll there also runs a job nobody picked up.
  const checkAgain = useCallback(async () => {
    const changed = await check().catch(() => false);
    if (!changed) router.refresh();
  }, [check, router]);

  useBackoffPoll(status === "processing" || status === "uploaded", check, giveUp);

  if (!gaveUp) return null;

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
      role="status"
    >
      Still scanning after a few minutes. Something may have gone wrong.
      <button
        className="min-h-11 rounded-md font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
        onClick={() => void checkAgain()}
        type="button"
      >
        Check again
      </button>
    </div>
  );
}

/**
 * Watches a server-rendered list while any row is still being scanned. Polls the
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
