// Kill switch for the receiptOCR service worker. Not used in normal operation.
//
// To switch the worker off for everyone, publish this file as /sw.js:
//   cp apps/web/public/sw-killswitch.js apps/web/public/sw.js
// and deploy. Browsers fetch /sw.js on their next visit (it is served with no-cache), install this
// version, delete every receiptocr-* cache, unregister and reload their open tabs, so pages load
// straight from the network again. Deleting sw.js is not enough: a missing script (404) leaves the
// installed worker running. Keep this file in place for weeks, until old installs have checked in.
// See "Disable the service worker" in docs/runbook.md.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("receiptocr-")).map((name) => caches.delete(name)),
      );
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
    })(),
  );
});
