"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While a receipt is still uploading/processing, polls its status endpoint
 * and refreshes the server-rendered page when the status changes.
 */
export function ProcessingPoller({ id, status }: { id: string; status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "processing" && status !== "uploaded") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/receipts/${id}`);
        if (!res.ok) return;
        const body = (await res.json()) as { status?: string };
        if (body.status && body.status !== status) router.refresh();
      } catch {
        // transient network error — keep polling
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [id, status, router]);

  return null;
}
