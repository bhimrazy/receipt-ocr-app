import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS, PROMPT_VERSION } from "@receipt-ocr/ai";
import type { Receipt } from "@receipt-ocr/db";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { NotConfigured, OcrError, StorageError } from "./errors";
import {
  claimRetry,
  deleteReceipt,
  ingestUpload,
  ocrCallRows,
  ocrFields,
  runExtraction,
  settleFailure,
} from "./pipeline";
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
  const calls: (OcrCallRow & { with: "complete" | "fail" | "record" })[] = [];
  const counts = () => ({
    userMinute: 0,
    day: options.usedToday ?? 0,
    month: null,
    planDay: null,
    globalDay: null,
  });

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
        return { kind: "inserted" as const, receipt: row as Receipt, jobId: `job-${id}` };
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
        promptVersion: PROMPT_VERSION,
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
