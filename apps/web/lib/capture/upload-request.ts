import type { UploadOutcome } from "./batch-queue";

/**
 * POST /api/receipts with upload progress. XMLHttpRequest because fetch still has no
 * upload progress events in every browser.
 */
export function postReceipt(
  file: File,
  mode: "instant" | "queued",
  onProgress: (fraction: number) => void = () => {},
): Promise<UploadOutcome> {
  const form = new FormData();
  form.set("file", file);
  form.set("mode", mode);
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/receipts");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? null) as { receiptId?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.receiptId) {
        resolve({ ok: true, receiptId: body.receiptId });
        return;
      }
      const retryAfter = Number(xhr.getResponseHeader("Retry-After"));
      resolve({
        ok: false,
        status: xhr.status,
        error: body?.error ?? "The upload failed. Try again.",
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    };
    xhr.onerror = () =>
      resolve({
        ok: false,
        error: "The upload didn't reach the server. Check your connection and try again.",
      });
    xhr.send(form);
  });
}
