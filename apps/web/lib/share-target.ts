// Web Share Target handoff. public/sw.js receives the POST from the Android share sheet, keeps
// the files in Cache Storage and redirects to the upload page, which takes them from here.
// The constants are repeated in public/sw.js (a plain script); share-target.test.ts keeps them equal.

export const SHARE_TARGET_PATH = "/share-target";
/** The multipart field name in the manifest's share_target. */
export const SHARE_TARGET_FIELD = "receipts";
export const SHARED_CACHE = "receiptocr-shared";
export const SHARED_NAME_HEADER = "x-shared-name";
export const SHARED_AT_HEADER = "x-shared-at";
/** Long enough to sign in first; after that a forgotten share is dropped, not uploaded. */
export const SHARED_TTL_MS = 10 * 60 * 1000;

/**
 * Returns the files shared to the app in the last 10 minutes and deletes every stored share,
 * fresh or stale, so receipts don't linger on the device. Empty when nothing was shared or
 * Cache Storage is unavailable.
 */
export async function takeSharedFiles(now = Date.now()): Promise<File[]> {
  if (typeof caches === "undefined") return [];
  try {
    if (!(await caches.has(SHARED_CACHE))) return [];
    const cache = await caches.open(SHARED_CACHE);
    const files: File[] = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      const sharedAt = Number(response?.headers.get(SHARED_AT_HEADER));
      if (!response || !(now - sharedAt <= SHARED_TTL_MS)) continue;
      const blob = await response.blob();
      files.push(
        new File([blob], fileName(response.headers.get(SHARED_NAME_HEADER)), {
          type: blob.type,
        }),
      );
    }
    await caches.delete(SHARED_CACHE);
    return files;
  } catch {
    return [];
  }
}

function fileName(encoded: string | null): string {
  try {
    return encoded ? decodeURIComponent(encoded) : "shared receipt";
  } catch {
    return "shared receipt";
  }
}
