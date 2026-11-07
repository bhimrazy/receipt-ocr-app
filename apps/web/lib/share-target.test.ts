import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHARE_TARGET_FIELD,
  SHARE_TARGET_PATH,
  SHARED_AT_HEADER,
  SHARED_CACHE,
  SHARED_NAME_HEADER,
  SHARED_TTL_MS,
  SHARED_TYPE_HEADER,
  clearSharedFiles,
  fileName,
  takeSharedFiles,
} from "./share-target";

/** In-memory Cache Storage with the calls takeSharedFiles makes. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const cache = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      put: async (key: string, response: Response) => void store.set(key, response),
      keys: async () => [...store.keys()].map((key) => new Request(`https://app.test${key}`)),
      match: async (request: Request) => store.get(new URL(request.url).pathname)?.clone(),
    };
  };
  return {
    stores,
    api: {
      has: async (name: string) => stores.has(name),
      open: async (name: string) => cache(name),
      delete: async (name: string) => stores.delete(name),
    },
  };
}

function shared(body: string, name: string, type: string, sharedAt: number) {
  return new Response(body, {
    headers: {
      [SHARED_TYPE_HEADER]: type,
      [SHARED_NAME_HEADER]: encodeURIComponent(name),
      [SHARED_AT_HEADER]: String(sharedAt),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("takeSharedFiles", () => {
  it("returns the shared files with their names and types, then clears them", async () => {
    const fake = fakeCaches();
    vi.stubGlobal("caches", fake.api);
    const now = 1_000_000;
    const cache = await fake.api.open(SHARED_CACHE);
    await cache.put("/share-target/file/0", shared("img", "Café receipt.jpg", "image/jpeg", now));
    await cache.put("/share-target/file/1", shared("%PDF", "bill.pdf", "application/pdf", now));

    const files = await takeSharedFiles(now + 1000);
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ["Café receipt.jpg", "image/jpeg"],
      ["bill.pdf", "application/pdf"],
    ]);
    expect(await files[1]!.text()).toBe("%PDF");
    expect(fake.stores.has(SHARED_CACHE)).toBe(false);
    expect(await takeSharedFiles(now + 2000)).toEqual([]);
  });

  it("keeps an empty type empty, so the upload panel goes by the extension", async () => {
    const fake = fakeCaches();
    vi.stubGlobal("caches", fake.api);
    const cache = await fake.api.open(SHARED_CACHE);
    await cache.put("/share-target/file/0", shared("img", "scan.heic", "", 5));
    const [file] = await takeSharedFiles(10);
    expect([file!.name, file!.type]).toEqual(["scan.heic", ""]);
  });

  it("drops shares older than ten minutes but still deletes them", async () => {
    const fake = fakeCaches();
    vi.stubGlobal("caches", fake.api);
    const cache = await fake.api.open(SHARED_CACHE);
    await cache.put("/share-target/file/0", shared("img", "old.jpg", "image/jpeg", 0));
    await cache.put("/share-target/file/1", shared("img", "bad.jpg", "image/jpeg", Number.NaN));

    expect(await takeSharedFiles(SHARED_TTL_MS + 1)).toEqual([]);
    expect(fake.stores.has(SHARED_CACHE)).toBe(false);
  });

  it("returns nothing without Cache Storage or when it fails", async () => {
    expect(await takeSharedFiles()).toEqual([]);
    vi.stubGlobal("caches", { has: () => Promise.reject(new Error("SecurityError")) });
    expect(await takeSharedFiles()).toEqual([]);
  });
});

describe("fileName", () => {
  it("decodes the shared name", () => {
    expect(fileName(encodeURIComponent("Café 1.jpg"), "image/jpeg")).toBe("Café 1.jpg");
  });

  it("falls back to shared-receipt with an extension from the type, or none", () => {
    expect(fileName(null, "image/jpeg")).toBe("shared-receipt.jpg");
    expect(fileName("", "application/pdf")).toBe("shared-receipt.pdf");
    expect(fileName("%E0%A4%A", "image/png")).toBe("shared-receipt.png");
    expect(fileName(null, "")).toBe("shared-receipt");
    expect(fileName(null, "image/x-unknown")).toBe("shared-receipt");
  });
});

describe("clearSharedFiles", () => {
  it("deletes the share cache, and is a no-op without Cache Storage", async () => {
    await expect(clearSharedFiles()).resolves.toBeUndefined();
    const fake = fakeCaches();
    vi.stubGlobal("caches", fake.api);
    await fake.api.open(SHARED_CACHE);
    await clearSharedFiles();
    expect(fake.stores.has(SHARED_CACHE)).toBe(false);
  });
});

describe("public/sw.js", () => {
  const sw = readFileSync(path.join(import.meta.dirname, "../public/sw.js"), "utf8");

  it("uses the same share-target names as the page", () => {
    for (const [name, value] of Object.entries({
      SHARE_TARGET_PATH,
      SHARE_TARGET_FIELD,
      SHARED_CACHE,
      SHARED_NAME_HEADER,
      SHARED_TYPE_HEADER,
      SHARED_AT_HEADER,
    })) {
      expect(sw).toContain(`const ${name} = "${value}";`);
    }
  });

  it("only ever responds to the share POST, navigations and its precached files", () => {
    // Guards the privacy rule: any new respondWith or cache.put needs a deliberate test change.
    expect(sw.match(/respondWith\(/g)).toHaveLength(3);
    expect(sw.match(/cache\.put\(/g)).toHaveLength(1);
    expect(sw).toContain(
      'const PRECACHE = [OFFLINE_URL, "/offline.js", "/icon.svg", "/icons/icon-192.png"];',
    );
  });

  it("drops shares posted from another site and files that aren't images or PDFs", () => {
    expect(sw).toContain('type === "" || type.startsWith("image/") || type === "application/pdf"');
    expect(sw).toContain("const MAX_SHARED_BYTES = 25 * 1024 * 1024;");
    expect(sw).toContain(`const SHARED_TTL_MS = ${SHARED_TTL_MS / 60_000} * 60 * 1000;`);
  });
});

describe("public/sw-killswitch.js", () => {
  const killswitch = readFileSync(
    path.join(import.meta.dirname, "../public/sw-killswitch.js"),
    "utf8",
  );

  it("activates at once, deletes every receiptocr cache and unregisters", () => {
    expect(killswitch).toContain("self.skipWaiting()");
    expect(killswitch).toContain('name.startsWith("receiptocr-")');
    expect(killswitch).toContain("self.registration.unregister()");
  });
});
