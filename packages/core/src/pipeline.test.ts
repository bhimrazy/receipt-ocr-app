import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS } from "@receipt-ocr/ai";
import type { Receipt } from "@receipt-ocr/db";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { NotConfigured, OcrError, StorageError } from "./errors";
import { claimRetry, deleteReceipt, extractStored, ingestUpload } from "./pipeline";
import {
  EXTRACTION_FAILED_MESSAGE,
  ReceiptRepo,
  type OcrCallRow,
  type ReceiptWithItems,
} from "./repository";
import { Ocr } from "./ocr";
import { Storage } from "./services";

const scope = { organizationId: "org-a", userId: "user-a" };
const limits = { perMinute: 10, perDay: 20 };
const USAGE = {
  inputTokens: 1000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 100,
  reasoningTokens: 40,
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** In-memory stand-ins for the three services the pipeline uses. */
function harness(
  options: {
    storagePut?: "fail";
    ocr?: "fixture" | "fail" | "unconfigured";
    /** The receipt is deleted while the model runs. */
    deleteDuringOcr?: boolean;
    /** Receipts the user has already used today, as the ledger would count them. */
    usedToday?: number;
  } = {},
) {
  const rows = new Map<string, ReceiptWithItems>();
  const objects = new Map<string, Uint8Array>();
  /** Every `ocr_calls` row written, with the outcome it was written with. */
  const calls: (OcrCallRow & { with: "complete" | "fail" })[] = [];
  const counts = () => ({ userMinute: 0, userDay: options.usedToday ?? 0, globalDay: null });

  const repo = Layer.succeed(ReceiptRepo, {
    insert: ({ id, scope, fileName, imageObjectKey }, quota) =>
      Effect.sync(() => {
        const verdict = quota.decide(counts());
        if (!verdict.allowed) return { kind: "quota" as const, verdict };
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
        return { kind: "inserted" as const, receipt: row as Receipt };
      }),
    complete: (id, _scope, attempt, extraction, model, written) =>
      Effect.sync(() => {
        calls.push(...written.map((call) => ({ ...call, with: "complete" as const })));
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
    fail: (id, _scope, attempt, message, written) =>
      Effect.sync(() => {
        calls.push(...written.map((call) => ({ ...call, with: "fail" as const })));
        const row = rows.get(id);
        if (!row || row.status !== "processing" || row.attempts !== attempt) return false;
        Object.assign(row, { status: "failed", errorMessage: message });
        return true;
      }),
    claimRetry: (id, _scope, quota) =>
      Effect.sync(() => {
        const verdict = quota.decide(counts());
        if (!verdict.allowed) return { kind: "quota" as const, verdict };
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
      if (options.deleteDuringOcr) rows.clear();
      const text = new TextDecoder().decode(file.data);
      if (options.ocr === "fail" || text.includes(FIXTURE_FAIL_MARKER)) {
        return Effect.fail(
          new OcrError({
            message: "Receipt extraction failed",
            kind: "provider-error",
            attempts: [
              {
                model: "google:gemini-3.8-flash",
                step: 0,
                kind: "invalid-output",
                ms: 9,
                usage: USAGE,
              },
              { model: "fixture", step: 1, kind: "provider-error", ms: 1, usage: null },
            ],
          }),
        );
      }
      return Effect.succeed({
        extraction: FIXTURE_RECEIPTS[0]!,
        usage: USAGE,
        model: "google:gemini-3.8-flash" as const,
        attempts: [
          { model: "google:gemini-3.8-flash", step: 0, kind: "ok" as const, ms: 1.6, usage: USAGE },
        ],
      });
    },
  });

  const run = <A, E>(effect: Effect.Effect<A, E, ReceiptRepo | Storage | Ocr>) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(Layer.mergeAll(repo, storage, ocr))));
  return { rows, objects, calls, run };
}

describe("ingestUpload", () => {
  it("stores the file under a key derived from id and sniffed type, never the file name", async () => {
    const h = harness();
    const exit = await h.run(
      ingestUpload({ scope, fileName: "../../evil.svg", body: JPEG, limits }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [key] = [...h.objects.keys()];
    expect(key).toMatch(/^users\/user-a\/receipts\/[0-9a-f-]{36}\.jpg$/);
    expect([...h.rows.values()][0]?.status).toBe("processing");
  });

  it("rejects non-receipt files before touching storage or the database", async () => {
    const h = harness();
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    const exit = await h.run(ingestUpload({ scope, fileName: "x.svg", body: svg, limits }));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
    expect(h.objects.size).toBe(0);
    expect(h.rows.size).toBe(0);
  });

  it("refuses over quota where the row is created, and removes the stored file", async () => {
    const h = harness({ usedToday: 20 });
    const exit = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("QuotaExceeded");
    expect(h.rows.size).toBe(0);
    expect(h.objects.size).toBe(0);
  });

  it("creates no row when storage fails, so nothing points at a missing file", async () => {
    const h = harness({ storagePut: "fail" });
    const exit = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(h.rows.size).toBe(0);
  });
});

describe("extractStored", () => {
  const ingestAndExtract = async (h: ReturnType<typeof harness>, body = JPEG) => {
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body, limits }));
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
    expect(h.rows.get(id)).toMatchObject({ status: "completed", model: "google:gemini-3.8-flash" });
  });

  it("writes each call with the completion, priced at write time", async () => {
    const h = harness();
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isSuccess(exit) && exit.value.costMicroUsd).toBe(1125);
    expect(h.calls).toEqual([
      expect.objectContaining({
        with: "complete",
        receiptId: id,
        organizationId: "org-a",
        userId: "user-a",
        round: 1,
        step: 0,
        model: "google:gemini-3.8-flash",
        provider: "google",
        status: "ok",
        latencyMs: 2,
        inputTokens: 1000,
        cacheWriteTokens: 0,
        outputTokens: 100,
        reasoningTokens: 40,
        // 1000 × 0.75 + 100 × 3.75; reasoning is inside output.
        costMicroUsd: 1125,
      }),
    ]);
  });

  it("still records the calls, once, when the receipt was deleted during extraction", async () => {
    const h = harness({ deleteDuringOcr: true });
    const { exit } = await ingestAndExtract(h);
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("NotFound");
    expect(h.calls.map((c) => [c.with, c.status])).toEqual([["complete", "ok"]]);
  });

  it("writes every failed attempt, known and unknown usage, with the failure", async () => {
    const h = harness({ ocr: "fail" });
    await ingestAndExtract(h);
    expect(h.calls.map((c) => [c.with, c.step, c.status, c.costMicroUsd, c.priceFrom])).toEqual([
      ["fail", 0, "invalid-output", 1125, "2026-11-06"],
      ["fail", 1, "provider-error", null, null],
    ]);
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
    // One row with no model, so the round doesn't read as in flight.
    expect(h.calls).toEqual([
      expect.objectContaining({
        with: "fail",
        receiptId: id,
        model: null,
        status: "not-configured",
        costMicroUsd: 0,
      }),
    ]);
  });

  it("records a no-model row when the stored file is gone", async () => {
    const h = harness();
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    h.objects.clear();
    await h.run(extractStored({ receiptId: ingested.value.receipt.id, scope }));
    expect(h.calls.map((c) => [c.with, c.model, c.status])).toEqual([
      ["fail", null, "storage-error"],
    ]);
  });
});

describe("claimRetry", () => {
  it("re-reads the stored file of a failed receipt, and the retry can then succeed", async () => {
    const h = harness();
    const body = new Uint8Array([...JPEG, ...new TextEncoder().encode(FIXTURE_FAIL_MARKER)]);
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await h.run(extractStored({ receiptId: id, scope }));
    expect(h.rows.get(id)?.status).toBe("failed");

    const claimed = await h.run(claimRetry({ receiptId: id, scope, limits }));
    expect(Exit.isSuccess(claimed)).toBe(true);
    expect(h.rows.get(id)).toMatchObject({ status: "processing", attempts: 2 });
  });

  it("refuses a receipt that has not failed, and a missing one", async () => {
    const h = harness();
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const busy = await h.run(claimRetry({ receiptId: ingested.value.receipt.id, scope, limits }));
    expect(Exit.isFailure(busy) && JSON.stringify(busy.cause)).toContain("Conflict");
    const missing = await h.run(claimRetry({ receiptId: "nope", scope, limits }));
    expect(Exit.isFailure(missing) && JSON.stringify(missing.cause)).toContain("NotFound");
  });

  it("a retried receipt is extracted from its stored file", async () => {
    const h = harness();
    const body = new Uint8Array([...JPEG, ...new TextEncoder().encode(FIXTURE_FAIL_MARKER)]);
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await h.run(extractStored({ receiptId: id, scope }));
    await h.run(claimRetry({ receiptId: id, scope, limits }));
    h.objects.set(h.rows.get(id)!.imageObjectKey!, JPEG);
    expect(Exit.isSuccess(await h.run(extractStored({ receiptId: id, scope })))).toBe(true);
    expect(h.rows.get(id)?.status).toBe("completed");
  });

  it("puts the receipt back to failed when its file can't be read", async () => {
    const h = harness({ ocr: "fail" });
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await h.run(extractStored({ receiptId: id, scope }));
    h.objects.clear();
    await h.run(claimRetry({ receiptId: id, scope, limits }));
    await h.run(extractStored({ receiptId: id, scope }));
    expect(h.rows.get(id)?.status).toBe("failed");
  });
});

describe("deleteReceipt (U1)", () => {
  it("deletes the stored file along with the row", async () => {
    const h = harness();
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    expect(h.objects.size).toBe(1);
    const exit = await h.run(deleteReceipt({ receiptId: ingested.value.receipt.id, scope }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(h.rows.size).toBe(0);
    expect(h.objects.size).toBe(0);
  });
});
