import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS } from "@receipt-ocr/ai";
import type { Receipt } from "@receipt-ocr/db";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { NotConfigured, OcrError, StorageError } from "./errors";
import { claimRetry, deleteReceipt, extractStored, ingestUpload } from "./pipeline";
import { EXTRACTION_FAILED_MESSAGE, ReceiptRepo, type ReceiptWithItems } from "./repository";
import { Ocr } from "./ocr";
import { Storage } from "./services";

const scope = { organizationId: "org-a", userId: "user-a" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** In-memory stand-ins for the three services the pipeline uses. */
function harness(options: { storagePut?: "fail"; ocr?: "fixture" | "fail" | "unconfigured" } = {}) {
  const rows = new Map<string, ReceiptWithItems>();
  const objects = new Map<string, Uint8Array>();

  const repo = Layer.succeed(ReceiptRepo, {
    insert: ({ id, scope, fileName, imageObjectKey }) =>
      Effect.sync(() => {
        const row = {
          id,
          organizationId: scope.organizationId,
          userId: scope.userId,
          status: "processing",
          fileName,
          imageObjectKey,
          errorMessage: null,
          attempts: 1,
          items: [],
          updatedAt: new Date(),
        } as unknown as ReceiptWithItems;
        rows.set(id, row);
        return row as Receipt;
      }),
    complete: (id, _scope, attempt, extraction, model) =>
      Effect.sync(() => {
        const row = rows.get(id);
        if (!row || row.status !== "processing" || row.attempts !== attempt) return null;
        Object.assign(row, {
          status: "completed",
          merchant: extraction.merchant,
          model,
          errorMessage: null,
        });
        return row;
      }),
    fail: (id, _scope, attempt, message) =>
      Effect.sync(() => {
        const row = rows.get(id);
        if (!row || row.status !== "processing" || row.attempts !== attempt) return false;
        Object.assign(row, { status: "failed", errorMessage: message });
        return true;
      }),
    claimRetry: (id) =>
      Effect.sync(() => {
        const row = rows.get(id);
        if (!row) return { kind: "not-found" as const };
        if (row.status !== "failed") return { kind: "not-retryable" as const };
        row.status = "processing";
        row.attempts += 1;
        return { kind: "claimed" as const, imageObjectKey: row.imageObjectKey };
      }),
    get: (id) => Effect.sync(() => rows.get(id) ?? null),
    list: () => Effect.die("unused"),
    counts: () => Effect.die("unused"),
    exportRows: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: (id) =>
      Effect.sync(() => {
        const row = rows.get(id);
        rows.delete(id);
        return row ? { imageObjectKey: row.imageObjectKey } : null;
      }),
    objectKeys: () => Effect.sync(() => [...objects.keys()]),
    usage: () => Effect.die("unused"),
  });

  const storage = Layer.succeed(Storage, {
    put: (key, body) =>
      options.storagePut === "fail"
        ? Effect.fail(new StorageError({ message: "bucket down" }))
        : Effect.sync(() => void objects.set(key, body)),
    get: (key) => {
      const body = objects.get(key);
      return body ? Effect.succeed(body) : Effect.fail(new StorageError({ message: "missing" }));
    },
    remove: (keys) => Effect.sync(() => keys.forEach((key) => objects.delete(key))),
    signedUrl: (key) => Effect.succeed(`https://signed/${key}`),
  });

  const ocr = Layer.succeed(Ocr, {
    ready: Effect.void,
    extract: (file) => {
      if (options.ocr === "unconfigured")
        return Effect.fail(new NotConfigured({ message: "no key" }));
      const text = new TextDecoder().decode(file.data);
      if (options.ocr === "fail" || text.includes(FIXTURE_FAIL_MARKER)) {
        return Effect.fail(
          new OcrError({
            message: "Receipt extraction failed",
            kind: "provider-error",
            attempts: [{ model: "fixture", kind: "provider-error", ms: 1 }],
          }),
        );
      }
      return Effect.succeed({
        extraction: FIXTURE_RECEIPTS[0]!,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 },
        model: "fixture" as const,
        attempts: [{ model: "fixture", kind: "ok" as const, ms: 1 }],
      });
    },
  });

  const run = <A, E>(effect: Effect.Effect<A, E, ReceiptRepo | Storage | Ocr>) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(Layer.mergeAll(repo, storage, ocr))));
  return { rows, objects, run };
}

describe("ingestUpload", () => {
  it("stores the file under a key derived from id and sniffed type, never the file name", async () => {
    const h = harness();
    const exit = await h.run(ingestUpload({ scope, fileName: "../../evil.svg", body: JPEG }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const [key] = [...h.objects.keys()];
    expect(key).toMatch(/^users\/user-a\/receipts\/[0-9a-f-]{36}\.jpg$/);
    expect([...h.rows.values()][0]?.status).toBe("processing");
  });

  it("rejects non-receipt files before touching storage or the database", async () => {
    const h = harness();
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    const exit = await h.run(ingestUpload({ scope, fileName: "x.svg", body: svg }));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
    expect(h.objects.size).toBe(0);
    expect(h.rows.size).toBe(0);
  });

  it("creates no row when storage fails, so nothing points at a missing file", async () => {
    const h = harness({ storagePut: "fail" });
    const exit = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG }));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(h.rows.size).toBe(0);
  });
});

describe("extractStored", () => {
  const ingestAndExtract = async (h: ReturnType<typeof harness>, body = JPEG) => {
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    return {
      id,
      exit: await h.run(extractStored({ receiptId: id, scope })),
    };
  };

  it("completes the receipt on success and records the model that read it", async () => {
    const h = harness();
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(h.rows.get(id)).toMatchObject({ status: "completed", model: "fixture" });
  });

  it("marks the receipt failed with a user-facing message when OCR fails", async () => {
    const h = harness({ ocr: "fail" });
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(h.rows.get(id)).toMatchObject({
      status: "failed",
      errorMessage: EXTRACTION_FAILED_MESSAGE,
    });
    expect(h.rows.get(id)?.errorMessage).not.toMatch(/gemini/i);
  });

  it("loads the receipt by id: unknown ids and receipts not processing are refused", async () => {
    const h = harness();
    const missing = await h.run(extractStored({ receiptId: "nope", scope }));
    expect(Exit.isFailure(missing) && JSON.stringify(missing.cause)).toContain("NotFound");
    const { id } = await ingestAndExtract(h);
    const again = await h.run(extractStored({ receiptId: id, scope }));
    expect(Exit.isFailure(again) && JSON.stringify(again.cause)).toContain("Conflict");
  });

  it("marks the receipt failed when OCR is not configured, instead of leaving it processing", async () => {
    const h = harness({ ocr: "unconfigured" });
    const { id } = await ingestAndExtract(h);
    expect(h.rows.get(id)?.status).toBe("failed");
  });
});

describe("claimRetry", () => {
  it("re-reads the stored file of a failed receipt, and the retry can then succeed", async () => {
    const h = harness();
    const body = new Uint8Array([...JPEG, ...new TextEncoder().encode(FIXTURE_FAIL_MARKER)]);
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await h.run(extractStored({ receiptId: id, scope }));
    expect(h.rows.get(id)?.status).toBe("failed");

    const claimed = await h.run(claimRetry({ receiptId: id, scope }));
    expect(Exit.isSuccess(claimed)).toBe(true);
    expect(h.rows.get(id)).toMatchObject({ status: "processing", attempts: 2 });
  });

  it("refuses a receipt that has not failed, and a missing one", async () => {
    const h = harness();
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const busy = await h.run(claimRetry({ receiptId: ingested.value.receipt.id, scope }));
    expect(Exit.isFailure(busy) && JSON.stringify(busy.cause)).toContain("Conflict");
    const missing = await h.run(claimRetry({ receiptId: "nope", scope }));
    expect(Exit.isFailure(missing) && JSON.stringify(missing.cause)).toContain("NotFound");
  });

  it("a retried receipt is extracted from its stored file", async () => {
    const h = harness();
    const body = new Uint8Array([...JPEG, ...new TextEncoder().encode(FIXTURE_FAIL_MARKER)]);
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await h.run(extractStored({ receiptId: id, scope }));
    await h.run(claimRetry({ receiptId: id, scope }));
    h.objects.set(h.rows.get(id)!.imageObjectKey!, JPEG);
    expect(Exit.isSuccess(await h.run(extractStored({ receiptId: id, scope })))).toBe(true);
    expect(h.rows.get(id)?.status).toBe("completed");
  });

  it("puts the receipt back to failed when its file can't be read", async () => {
    const h = harness({ ocr: "fail" });
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await h.run(extractStored({ receiptId: id, scope }));
    h.objects.clear();
    await h.run(claimRetry({ receiptId: id, scope }));
    await h.run(extractStored({ receiptId: id, scope }));
    expect(h.rows.get(id)?.status).toBe("failed");
  });
});

describe("deleteReceipt (U1)", () => {
  it("deletes the stored file along with the row", async () => {
    const h = harness();
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    expect(h.objects.size).toBe(1);
    const exit = await h.run(deleteReceipt({ receiptId: ingested.value.receipt.id, scope }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(h.rows.size).toBe(0);
    expect(h.objects.size).toBe(0);
  });
});
