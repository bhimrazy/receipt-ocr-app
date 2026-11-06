import { ConfigProvider, Effect, Fiber, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DbError } from "./errors";
import { checkReadiness } from "./health";
import { Db } from "./services";

const probeBucket = vi.hoisted(() => vi.fn());
vi.mock("@receipt-ocr/storage", () => ({ probeBucket }));

const dbWith = (use: () => Effect.Effect<unknown, DbError>) =>
  Layer.succeed(Db, { client: {} as never, use: use as never });

const noStorage = ConfigProvider.fromMap(new Map());
const withStorage = ConfigProvider.fromMap(
  new Map([
    ["S3_BUCKET", "receipts"],
    ["S3_ACCESS_KEY_ID", "id"],
    ["S3_SECRET_ACCESS_KEY", "secret"],
  ]),
);

/** Runs the check on the test clock, moving it past the timeout. */
const run = (db: Layer.Layer<Db>, config = noStorage) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(checkReadiness);
      yield* TestClock.adjust("3 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(
      Effect.provide(db),
      Effect.withConfigProvider(config),
      Effect.provide(TestContext.TestContext),
    ),
  );

describe("checkReadiness", () => {
  it("is ok when the database answers and storage is not configured", async () => {
    expect(await run(dbWith(() => Effect.succeed([])))).toEqual({
      ok: true,
      checks: { database: "ok", storage: "not_configured" },
    });
  });

  it("is down when the query fails, with no error text in the result", async () => {
    const result = await run(
      dbWith(() => Effect.fail(new DbError({ message: "password authentication failed" }))),
    );
    expect(result).toEqual({ ok: false, checks: { database: "down", storage: "not_configured" } });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("is down when the database hangs past the timeout", async () => {
    const result = await run(dbWith(() => Effect.never));
    expect(result.checks.database).toBe("down");
  });

  it("checks storage when configured", async () => {
    probeBucket.mockResolvedValueOnce(undefined);
    expect(
      (
        await run(
          dbWith(() => Effect.succeed([])),
          withStorage,
        )
      ).checks.storage,
    ).toBe("ok");
    probeBucket.mockRejectedValueOnce(new Error("AccessDenied"));
    const down = await run(
      dbWith(() => Effect.succeed([])),
      withStorage,
    );
    expect(down).toEqual({ ok: false, checks: { database: "ok", storage: "down" } });
  });
});
