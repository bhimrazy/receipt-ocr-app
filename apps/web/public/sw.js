// receiptOCR service worker: offline fallback for page loads and the Web Share Target handoff.
// Receipts are financial data, so nothing user-specific is stored: no API responses, no signed-in
// HTML, no receipt images. Only the files below are cached, plus shared files for at most 10 minutes
// (see lib/share-target.ts). Bump VERSION whenever this file or a precached file changes.
const VERSION = "1";
const STATIC_CACHE = `receiptocr-static-v${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon.svg", "/icons/icon-192.png"];

// Must match lib/share-target.ts.
const SHARE_TARGET_PATH = "/share-target";
const SHARE_TARGET_FIELD = "receipts";
const SHARED_CACHE = "receiptocr-shared";
const SHARED_NAME_HEADER = "x-shared-name";
const SHARED_AT_HEADER = "x-shared-at";
// The upload panel's batch limit.
const MAX_SHARED_FILES = 20;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("receiptocr-static-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      // Starts the page request while the worker boots, so network-first costs no extra latency.
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
  // Everything else (API calls, RSC payloads, receipt images, scripts) goes to the network
  // untouched and is never stored here.
});

/** Network first; the page itself is never cached. Offline, the precached fallback. */
async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    return preloaded ?? (await fetch(event.request));
  } catch {
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

/** Stores the shared files (replacing any earlier share) and sends the visitor to upload them. */
async function receiveShare(request) {
  let target = "/app/upload?shared=1";
  try {
    const form = await request.formData();
    const files = form
      .getAll(SHARE_TARGET_FIELD)
      .filter((value) => typeof value !== "string")
      .slice(0, MAX_SHARED_FILES);
    await caches.delete(SHARED_CACHE);
    const cache = await caches.open(SHARED_CACHE);
    const sharedAt = String(Date.now());
    await Promise.all(
      files.map((file, index) =>
        cache.put(
          `/share-target/file/${index}`,
          new Response(file, {
            headers: {
              "content-type": file.type || "application/octet-stream",
              [SHARED_NAME_HEADER]: encodeURIComponent(file.name),
              [SHARED_AT_HEADER]: sharedAt,
            },
          }),
        ),
      ),
    );
  } catch {
    // Quota or a malformed body: the upload page still opens, with nothing queued.
    target = "/app/upload?shared=failed";
  }
  return Response.redirect(new URL(target, self.location.origin).href, 303);
}
