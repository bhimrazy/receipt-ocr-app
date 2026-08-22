"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Give up after this long; background extraction should never take longer. */
const MAX_POLL_MS = 3 * 60 * 1000;
const BASE_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 15000;

/**
 * While a receipt is still uploading/processing, polls its status endpoint and
 * refreshes the server-rendered page when the status changes.
 *
 * The interval backs off and the whole thing gives up after MAX_POLL_MS: the
 * previous version hammered the API every 2.5s forever if the background job
 * died, which is a request per user per 2.5s with nothing to show for it.
 */
export function ProcessingPoller({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (status !== "processing" && status !== "uploaded") return;

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();

    async function tick() {
      if (cancelled) return;
      if (Date.now() - startedAt > MAX_POLL_MS) {
        setGaveUp(true);
        return;
      }
      try {
        const res = await fetch(`/api/receipts/${id}`);
        if (res.ok) {
          const body = (await res.json()) as { status?: string };
          if (body.status && body.status !== status) {
            router.refresh();
            return;
          }
        }
      } catch {
        // transient network error — keep polling on the backed-off schedule
      }
      attempt += 1;
      const delay = Math.min(BASE_INTERVAL_MS * 2 ** Math.floor(attempt / 3), MAX_INTERVAL_MS);
      timer = setTimeout(tick, delay);
    }

    timer = setTimeout(tick, BASE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, status, router]);

  if (!gaveUp) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      Still processing after a few minutes — something may have gone wrong.{" "}
      <button className="underline" onClick={() => router.refresh()} type="button">
        Check again
      </button>
      .
    </div>
  );
}
