import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS, PROMPT_VERSION } from "@receipt-ocr/ai";
import type { Receipt } from "@receipt-ocr/db";
import { Effect, Exit, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { DbError, NotConfigured, OcrError, StorageError } from "../src/errors";
import {
  claimRetry,
  deleteReceipt,
  fileMetaOf,
  ingestUpload,
  ocrCallRows,
  ocrFields,
  runExtraction,
  settleFailure,
} from "../src/pipeline";
import {
  EXTRACTION_FAILED_MESSAGE,
  type InsertResult,
  ReceiptRepo,
  type OcrCallRow,
  type ReceiptWithItems,
} from "../src/repository";
import { Ocr } from "../src/ocr";
import { MB } from "../src/plans";
import { Storage } from "../src/services";
import { decideStorage } from "../src/storage-quota";

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
    /** The insert fails with a DbError wrapping this driver error, while committing when `atCommit`. */
    insertFails?: { cause: unknown; atCommit?: boolean };
    ocr?: "fixture" | "fail" | "unconfigured";
    /** The receipt is deleted while the model runs. */
    deleteDuringOcr?: boolean;
    /** Receipts the user has already used today, as the ledger would count them. */
    usedToday?: number;
    /** Bytes the workspace already stores. */
    storedBytes?: number;
    /** Bytes another upload stores between the early check and the insert. */
    racedBytes?: number;
  } = {},
) {
  const rows = new Map<string, ReceiptWithItems>();
  const objects = new Map<string, Uint8Array>();
  /** Every `ocr_calls` row written, with the outcome it was written with. */
  const calls: (OcrCallRow & { with: "complete" | "fail" | "record" })[] = [];
  const counts = () => ({
    userMinute: 0,
    day: options.usedToday ?? 0,
    month: null,
    planDay: null,
    globalDay: null,
  });

  const stored = () =>
    (options.storedBytes ?? 0) +
    [...rows.values()].reduce((sum, row) => sum + (row.fileBytes ?? 0), 0);

  const repo = Layer.succeed(ReceiptRepo, {
    insert: ({ id, scope, fileName, imageObjectKey, fileBytes, fileMeta }, quota) =>
      Effect.suspend((): Effect.Effect<InsertResult, DbError> => {
        if (options.insertFails) {
          return Effect.fail(new DbError({ message: "insert", ...options.insertFails }));
        }
        const verdict = quota.decide(counts());
        if (!verdict.allowed) return Effect.succeed({ kind: "quota" as const, verdict });
        if (quota.storageBytes !== null) {
          const storage = decideStorage(
            stored() + (options.racedBytes ?? 0),
            fileBytes,
            quota.storageBytes,
          );
          if (!storage.allowed)
            return Effect.succeed({ kind: "storage" as const, verdict: storage });
        }
        const row = {
          id,
          organizationId: scope.organizationId,
          userId: scope.userId,
          status: "processing",
          fileName,
          imageObjectKey,
          fileBytes,
          fileMeta,
          errorMessage: null,
          attempts: 1,
          items: [],
          updatedAt: new Date(),
        } as unknown as ReceiptWithItems;
        rows.set(id, row);
        return Effect.succeed({
          kind: "inserted" as const,
          receipt: row as unknown as Receipt,
          jobId: `job-${id}`,
        });
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
    recordCalls: (written) =>
      Effect.sync(() => {
        calls.push(...written.map((call) => ({ ...call, with: "record" as const })));
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
        return {
          kind: "claimed" as const,
          round: row.attempts,
          jobId: `job-${id}-${row.attempts}`,
        };
      }),
    get: (id) => Effect.sync(() => rows.get(id) ?? null),
    list: () => Effect.die("unused"),
    counts: () => Effect.die("unused"),
    matchingIds: () => Effect.die("unused"),
    exportRows: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    setReviewed: () => Effect.die("unused"),
    setDuplicateDismissed: () => Effect.die("unused"),
    removeMany: (_scope, target) =>
      Effect.sync(() => {
        const ids = "ids" in target ? target.ids : [];
        const gone = ids.filter((id) => rows.delete(id));
        return {
          kind: "deleted" as const,
          deleted: gone,
          skipped: 0,
          notFound: ids.length - gone.length,
          jobId: gone.length > 0 ? "job-cleanup" : null,
        };
      }),
    objectKeys: () => Effect.sync(() => [...objects.keys()]),
    usage: () => Effect.die("unused"),
    storageUsed: () => Effect.sync(stored),
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
    size: (key) => Effect.die(`unused: ${key}`),
    remove: (keys) => Effect.sync(() => keys.forEach((key) => objects.delete(key))),
    signedUrl: (key) => Effect.succeed(`https://signed/${key}`),
    list: () => Effect.succeed({ objects: [] }),
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
        promptVersion: PROMPT_VERSION,
        attempts: [
          { model: "google:gemini-3.8-flash", step: 0, kind: "ok" as const, ms: 1.6, usage: USAGE },
        ],
      });
    },
  });

  /** Messages logged through Effect's logger. */
  const logs: unknown[] = [];
  const logger = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ message }) => void logs.push(...(Array.isArray(message) ? message : [message]))),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, ReceiptRepo | Storage | Ocr>) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(Layer.mergeAll(repo, storage, ocr, logger))));
  return { rows, objects, calls, logs, run };
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

  const pgError = (code: string) => Object.assign(new Error("pg"), { code });
  const ingest = (h: ReturnType<typeof harness>) =>
    h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));

  it.each([
    ["a pool connect timeout", { cause: new Error("timeout exceeded when trying to connect") }],
    ["a timeout before COMMIT", { cause: new Error("Query read timeout") }],
    ["a statement Postgres refused", { cause: pgError("57014") }],
    ["a server error on COMMIT, which rolls back", { cause: pgError("40001"), atCommit: true }],
    ["a socket errno before COMMIT", { cause: pgError("EPIPE") }],
  ])("removes the stored file after %s: the insert can't have committed", async (_, fails) => {
    const h = harness({ insertFails: fails });
    const exit = await ingest(h);
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("DbError");
    expect(h.objects.size).toBe(0);
    expect(h.logs).not.toContain("receipt.ingest_unknown");
  });

  it.each([
    ["timed out", new Error("Query read timeout")],
    ["lost its socket", pgError("EPIPE")],
    ["got a pooler's connection error", pgError("08P01")],
  ])(
    "keeps the stored file and logs it when COMMIT %s, as it may have committed",
    async (_, cause) => {
      const h = harness({ insertFails: { cause, atCommit: true } });
      const exit = await ingest(h);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(h.objects.size).toBe(1);
      expect(h.logs).toContain("receipt.ingest_unknown");
    },
  );

  it("records the file's size and what its bytes say about it", async () => {
    const h = harness();
    const exit = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const row = [...h.rows.values()][0];
    expect(row?.fileBytes).toBe(JPEG.byteLength);
    expect(row?.fileMeta).toEqual({ contentType: "image/jpeg" });
  });

  const capped = { ...limits, storageBytes: 100 * MB };

  it("refuses a full workspace before storing anything", async () => {
    const h = harness({ storedBytes: 100 * MB });
    const exit = await h.run(
      ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits: capped }),
    );
    const cause = Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "";
    expect(cause).toContain("QuotaExceeded");
    expect(cause).toContain('"kind":"storage"');
    expect(cause).toContain("This workspace's storage is full: 100 MB used.");
    expect(h.objects.size).toBe(0);
    expect(h.rows.size).toBe(0);
  });

  it("takes a file that fits exactly, and refuses one byte more", async () => {
    const fits = harness({ storedBytes: 100 * MB - JPEG.byteLength });
    expect(
      Exit.isSuccess(
        await fits.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits: capped })),
      ),
    ).toBe(true);
    const over = harness({ storedBytes: 100 * MB - JPEG.byteLength + 1 });
    const exit = await over.run(
      ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits: capped }),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      "This file doesn't fit in this workspace's storage: 100 MB of 100 MB used.",
    );
  });

  it("refuses where the row is created when a parallel upload took the room, and removes the file", async () => {
    const h = harness({ storedBytes: 100 * MB - JPEG.byteLength, racedBytes: 1 });
    const exit = await h.run(
      ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits: capped }),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('"kind":"storage"');
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

/** One attempt of the receipt's current round, as its job would run it. */
const attempt = (h: ReturnType<typeof harness>, id: string, jobAttempt = 1) =>
  h.run(runExtraction({ receiptId: id, scope, round: h.rows.get(id)?.attempts ?? 1, jobAttempt }));

/** The round's last attempt failed: the job is dead and settles the receipt. */
const failRound = async (h: ReturnType<typeof harness>, id: string) => {
  await attempt(h, id);
  await h.run(settleFailure({ receiptId: id, scope, round: h.rows.get(id)!.attempts }));
};

describe("runExtraction", () => {
  const ingestAndExtract = async (h: ReturnType<typeof harness>, body = JPEG) => {
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    expect(ingested.value.jobId).toBe(`job-${id}`);
    return { id, exit: await attempt(h, id) };
  };

  it("completes the receipt on success and records the model that read it", async () => {
    const h = harness();
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isSuccess(exit) && exit.value.kind).toBe("completed");
    expect(h.rows.get(id)).toMatchObject({ status: "completed", model: "google:gemini-3.8-flash" });
  });

  it("writes each call with the completion, priced at write time", async () => {
    const h = harness();
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isSuccess(exit) && exit.value.kind === "completed" && exit.value.costMicroUsd).toBe(
      1125,
    );
    expect(h.calls).toEqual([
      expect.objectContaining({
        with: "complete",
        receiptId: id,
        organizationId: "org-a",
        userId: "user-a",
        round: 1,
        jobAttempt: 1,
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
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ kind: "skipped", reason: "superseded" });
    expect(h.calls.map((c) => [c.with, c.status])).toEqual([["complete", "ok"]]);
  });

  it("records every failed call of the attempt, known and unknown usage, under its job attempt", async () => {
    const h = harness({ ocr: "fail" });
    const { id } = await ingestAndExtract(h);
    await attempt(h, id, 2);
    expect(
      h.calls.map((c) => [c.with, c.jobAttempt, c.step, c.status, c.costMicroUsd, c.priceFrom]),
    ).toEqual([
      ["record", 1, 0, "invalid-output", 1125, "2026-11-06"],
      ["record", 1, 1, "provider-error", null, null],
      ["record", 2, 0, "invalid-output", 1125, "2026-11-06"],
      ["record", 2, 1, "provider-error", null, null],
    ]);
  });

  it("a failed attempt leaves the receipt processing; settling marks it failed for the UI", async () => {
    const h = harness({ ocr: "fail" });
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("OcrError");
    expect(h.rows.get(id)?.status).toBe("processing");
    expect(await h.run(settleFailure({ receiptId: id, scope, round: 1 }))).toEqual(
      Exit.succeed(true),
    );
    expect(h.rows.get(id)).toMatchObject({
      status: "failed",
      errorMessage: EXTRACTION_FAILED_MESSAGE,
    });
    expect(h.rows.get(id)?.errorMessage).not.toMatch(/gemini/i);
  });

  it("skips a receipt that is gone, finished, or on a newer round", async () => {
    const h = harness();
    const missing = await h.run(
      runExtraction({ receiptId: "nope", scope, round: 1, jobAttempt: 1 }),
    );
    expect(Exit.isSuccess(missing) && missing.value).toEqual({
      kind: "skipped",
      reason: "not-found",
    });
    const { id } = await ingestAndExtract(h);
    const again = await attempt(h, id);
    expect(Exit.isSuccess(again) && again.value).toEqual({ kind: "skipped", reason: "superseded" });
    const old = await h.run(runExtraction({ receiptId: id, scope, round: 0, jobAttempt: 1 }));
    expect(Exit.isSuccess(old) && old.value.kind).toBe("skipped");
  });

  it("records a no-model row when OCR is not configured", async () => {
    const h = harness({ ocr: "unconfigured" });
    const { id, exit } = await ingestAndExtract(h);
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("NotConfigured");
    // One row with no model, so the round doesn't read as in flight.
    expect(h.calls).toEqual([
      expect.objectContaining({
        with: "record",
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
    await attempt(h, ingested.value.receipt.id);
    expect(h.calls.map((c) => [c.with, c.model, c.status])).toEqual([
      ["record", null, "storage-error"],
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
    await failRound(h, id);
    expect(h.rows.get(id)?.status).toBe("failed");

    const claimed = await h.run(claimRetry({ receiptId: id, scope, limits }));
    expect(claimed).toEqual(Exit.succeed({ round: 2, jobId: `job-${id}-2` }));
    expect(h.rows.get(id)).toMatchObject({ status: "processing", attempts: 2 });
    h.objects.set(h.rows.get(id)!.imageObjectKey!, JPEG);
    expect(Exit.isSuccess(await attempt(h, id))).toBe(true);
    expect(h.rows.get(id)?.status).toBe("completed");
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

  it("a stale round's settle can't fail the retried receipt", async () => {
    const h = harness({ ocr: "fail" });
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const id = ingested.value.receipt.id;
    await failRound(h, id);
    await h.run(claimRetry({ receiptId: id, scope, limits }));
    expect(await h.run(settleFailure({ receiptId: id, scope, round: 1 }))).toEqual(
      Exit.succeed(false),
    );
    expect(h.rows.get(id)?.status).toBe("processing");
  });
});

describe("deleteReceipt (U1)", () => {
  it("deletes the row and returns the job that deletes its stored file", async () => {
    const h = harness();
    const ingested = await h.run(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    if (!Exit.isSuccess(ingested)) throw new Error("ingest failed");
    const exit = await h.run(deleteReceipt({ receiptId: ingested.value.receipt.id, scope }));
    expect(exit).toEqual(Exit.succeed({ jobId: "job-cleanup" }));
    expect(h.rows.size).toBe(0);
  });

  it("is NotFound when nothing was deleted", async () => {
    const h = harness();
    const exit = await h.run(deleteReceipt({ receiptId: crypto.randomUUID(), scope }));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("NotFound");
  });
});

describe("ocrCallRows", () => {
  const context = {
    receiptId: "r1",
    scope: { organizationId: "o1", userId: "u1" },
    round: 1,
    jobAttempt: 1,
    at: new Date("2026-11-07T12:00:00Z"),
  };
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 200,
    reasoningTokens: 0,
  };

  it("records a skipped step with its provider but no model, free and instant", () => {
    const rows = ocrCallRows(
      [
        {
          model: "anthropic:claude-haiku-5-5",
          step: 0,
          kind: "unsupported-file",
          ms: 3,
          usage: null,
          skipped: true,
        },
        { model: "google:gemini-3.8-flash", step: 1, kind: "ok", ms: 2100, usage },
      ],
      context,
    );
    // `model is not null` is what quota (failedPaid, roundsSince), latency and the unpriced count
    // read as "a model was called"; a skip must not match it.
    expect(rows[0]).toMatchObject({
      step: 0,
      model: null,
      provider: "anthropic",
      status: "unsupported-file",
      costMicroUsd: 0,
      latencyMs: 0,
    });
    expect(rows[1]).toMatchObject({ step: 1, model: "google:gemini-3.8-flash", status: "ok" });
    expect(ocrFields(rows)).toMatchObject({
      calls: 1,
      model: "google:gemini-3.8-flash",
      prompt_version: PROMPT_VERSION,
    });
    // Only skips: no model read anything, so no prompt version either.
    expect(ocrFields(rows.slice(0, 1)).prompt_version).toBeUndefined();
  });

  it("keeps the model on a 413, which did reach the provider", () => {
    const [row] = ocrCallRows(
      [
        {
          model: "anthropic:claude-haiku-5-5",
          step: 0,
          kind: "unsupported-file",
          ms: 400,
          usage: null,
        },
      ],
      context,
    );
    expect(row).toMatchObject({ model: "anthropic:claude-haiku-5-5", latencyMs: 400 });
  });
});

describe("fileMetaOf", () => {
  it("keeps an image's pixel size from its header, and only the type for a PDF", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    png.set(new TextEncoder().encode("IHDR"), 12);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 1600);
    expect(fileMetaOf(png, "image/png")).toEqual({
      contentType: "image/png",
      width: 1200,
      height: 1600,
    });
    const pdf = new TextEncoder().encode("%PDF-1.7");
    expect(fileMetaOf(pdf, "application/pdf")).toEqual({ contentType: "application/pdf" });
  });
});
