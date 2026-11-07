import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { SHARED_AT_HEADER, SHARED_CACHE, SHARED_TTL_MS } from "./share-target";

// Runs the real public/sw.js against a fake worker scope and posts real multipart bodies to it.
const source = readFileSync(path.join(import.meta.dirname, "../public/sw.js"), "utf8");
const ORIGIN = "https://app.test";

type Handler = (event: Record<string, unknown>) => void;

function loadWorker() {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    match: async () => undefined,
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        put: async (key: string, response: Response) => void store.set(key, response),
        keys: async () => [...store.keys()],
        match: async (key: string) => store.get(key),
        delete: async (key: string) => store.delete(key),
      };
    },
  };
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
  };
  vm.runInNewContext(source, { self, caches, URL, Request, Response, Date, Number, Promise });
  return { stores, caches, handlers };
}

async function share(
  files: File[],
  referrer = "",
  worker = loadWorker(),
  field = "receipts",
): Promise<{ location: string | null; worker: ReturnType<typeof loadWorker> }> {
  const body = new FormData();
  for (const file of files) body.append(field, file);
  const request = new Request(`${ORIGIN}/share-target`, { method: "POST", body, referrer });
  let response: Promise<Response> | undefined;
  worker.handlers.fetch({ request, respondWith: (r: Promise<Response>) => (response = r) });
  const result = await response;
  return { location: result?.headers.get("location") ?? null, worker };
}

const png = new File([new Uint8Array([1, 2, 3])], "r.png", { type: "image/png" });

describe("public/sw.js share POST", () => {
  it("stores a shared image and sends the visitor to the upload page", async () => {
    const { location, worker } = await share([png]);
    expect(location).toBe(`${ORIGIN}/app/upload?shared=1`);
    expect(worker.stores.get(SHARED_CACHE)?.size).toBe(1);
  });

  it("accepts the Android app referrer but drops a web page on another site", async () => {
    const app = await share([png], "android-app://com.example.gallery");
    expect(app.location).toBe(`${ORIGIN}/app/upload?shared=1`);
    const same = await share([png], `${ORIGIN}/app`);
    expect(same.location).toBe(`${ORIGIN}/app/upload?shared=1`);
    const foreign = await share([png], "https://evil.example/page");
    expect(foreign.location).toBe(`${ORIGIN}/app`);
    expect(foreign.worker.stores.has(SHARED_CACHE)).toBe(false);
  });

  it("redirects to /app?shared=failed when nothing usable was shared", async () => {
    const text = new File(["hello"], "note.txt", { type: "text/plain" });
    const { location, worker } = await share([text]);
    expect(location).toBe(`${ORIGIN}/app?shared=failed`);
    expect(worker.stores.has(SHARED_CACHE)).toBe(false);
    expect((await share([], "", worker)).location).toBe(`${ORIGIN}/app?shared=failed`);
  });

  it("redirects to /app?shared=failed when the body can't be scanned", async () => {
    const worker = loadWorker();
    const request = new Request(`${ORIGIN}/share-target`, {
      method: "POST",
      body: "not multipart",
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    let response: Promise<Response> | undefined;
    worker.handlers.fetch({ request, respondWith: (r: Promise<Response>) => (response = r) });
    expect((await response)?.headers.get("location")).toBe(`${ORIGIN}/app?shared=failed`);
  });

  it("prunes expired shares on navigation", async () => {
    const worker = loadWorker();
    const cache = await worker.caches.open(SHARED_CACHE);
    const stale = String(Date.now() - SHARED_TTL_MS - 1000);
    await cache.put(
      "/share-target/file/0",
      new Response("x", { headers: { [SHARED_AT_HEADER]: stale } }),
    );
    const waits: Promise<unknown>[] = [];
    worker.handlers.fetch({
      request: { url: `${ORIGIN}/app`, method: "GET", mode: "navigate" },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (r: Promise<Response>) => void r.catch(() => {}),
    });
    await Promise.all(waits);
    expect(await cache.keys()).toHaveLength(0);
  });

  it("refuses 21 files, an oversized file and an oversized total, keeping a pending share", async () => {
    const worker = loadWorker();
    expect((await share([png], "", worker)).location).toContain("shared=1");
    const pending = [...worker.stores.get(SHARED_CACHE)!.keys()];
    const many = Array.from({ length: 21 }, () => png);
    expect((await share(many, "", worker)).location).toBe(`${ORIGIN}/app?shared=failed`);
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
    expect((await share([big], "", worker)).location).toBe(`${ORIGIN}/app?shared=failed`);
    const nine = () => new File([new Uint8Array(9 * 1024 * 1024)], "n.png", { type: "image/png" });
    const six = Array.from({ length: 6 }, nine);
    expect((await share(six, "", worker)).location).toBe(`${ORIGIN}/app?shared=failed`);
    expect([...worker.stores.get(SHARED_CACHE)!.keys()]).toEqual(pending);
  });

  it("refuses a declared body that is too large before reading it", async () => {
    const worker = loadWorker();
    const request = {
      url: `${ORIGIN}/share-target`,
      method: "POST",
      referrer: "",
      headers: new Headers({ "content-length": String(200 * 1024 * 1024) }),
      formData: () => Promise.reject(new Error("must not be read")),
    };
    let response: Promise<Response> | undefined;
    worker.handlers.fetch({ request, respondWith: (r: Promise<Response>) => (response = r) });
    expect((await response)?.headers.get("location")).toBe(`${ORIGIN}/app?shared=failed`);
  });
});
