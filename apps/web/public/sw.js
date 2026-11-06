// receiptOCR service worker: offline fallback for page loads and the Web Share Target handoff.
// Receipts are financial data, so nothing user-specific is stored: no API responses, no signed-in
// HTML, no receipt images. Only the files below are cached, plus shared files for at most 10 minutes
// (see lib/share-target.ts). Bump VERSION whenever this file or a precached file changes.
// To switch the worker off in production, see "Disable the service worker" in docs/runbook.md.
const VERSION = "2";
const STATIC_CACHE = `receiptocr-static-v${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/offline.js", "/icon.svg", "/icons/icon-192.png"];

// Must match lib/share-target.ts.
const SHARE_TARGET_PATH = "/share-target";
const SHARE_TARGET_FIELD = "receipts";
const SHARED_CACHE = "receiptocr-shared";
const SHARED_NAME_HEADER = "x-shared-name";
const SHARED_TYPE_HEADER = "x-shared-type";
const SHARED_AT_HEADER = "x-shared-at";
const SHARED_TTL_MS = 10 * 60 * 1000;
// The upload panel's batch limit, and a per-file cap well above anything it accepts.
const MAX_SHARED_FILES = 20;
const MAX_SHARED_BYTES = 25 * 1024 * 1024;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // "reload" skips the HTTP cache, so a new VERSION never precaches a stale copy.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
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
      await pruneExpiredShares();
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

/** Drops shares nobody picked up within the time limit. */
async function pruneExpiredShares() {
  if (!(await caches.has(SHARED_CACHE))) return;
  const cache = await caches.open(SHARED_CACHE);
  const now = Date.now();
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    const sharedAt = Number(response?.headers.get(SHARED_AT_HEADER));
    if (!(now - sharedAt <= SHARED_TTL_MS)) await cache.delete(request);
  }
}

/** Multipart bodies label a file with no type as octet-stream; both mean "go by the extension". */
function sharedType(file) {
  const type = file.type.toLowerCase();
  return type === "application/octet-stream" ? "" : type;
}

function acceptable(file) {
  const type = sharedType(file);
  const typeOk = type === "" || type.startsWith("image/") || type === "application/pdf";
  return typeOk && file.size <= MAX_SHARED_BYTES;
}

/**
 * Stores the shared files and sends the visitor to upload them. A new share replaces any earlier
 * one, expired or not. The upload panel still asks before queueing them, since any site can post here.
 */
async function receiveShare(request) {
  const redirect = (path) => Response.redirect(new URL(path, self.location.origin).href, 303);
  // The Android share sheet sends no referrer. A page on another site posting here is dropped
  // (it can hide its referrer, which is why the panel asks too).
  if (request.referrer && new URL(request.referrer).origin !== self.location.origin) {
    return redirect("/app/upload");
  }
  try {
    await caches.delete(SHARED_CACHE);
    const form = await request.formData();
    const files = form
      .getAll(SHARE_TARGET_FIELD)
      .filter((value) => typeof value !== "string" && acceptable(value))
      .slice(0, MAX_SHARED_FILES);
    if (files.length === 0) return redirect("/app/upload?shared=failed");
    const cache = await caches.open(SHARED_CACHE);
    const sharedAt = String(Date.now());
    await Promise.all(
      files.map((file, index) =>
        cache.put(
          `/share-target/file/${index}`,
          new Response(file, {
            headers: {
              [SHARED_NAME_HEADER]: encodeURIComponent(file.name),
              // Kept even when empty, so the panel can fall back to the file extension.
              [SHARED_TYPE_HEADER]: sharedType(file),
              [SHARED_AT_HEADER]: sharedAt,
            },
          }),
        ),
      ),
    );
    return redirect("/app/upload?shared=1");
  } catch {
    // Quota or a malformed body: the upload page still opens, with nothing waiting.
    return redirect("/app/upload?shared=failed");
  }
}
