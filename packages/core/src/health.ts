import { sql } from "@receipt-ocr/db";
import { probeBucket } from "@receipt-ocr/storage";
import { Duration, Effect } from "effect";
import { loadStorageConfig } from "./config";
import { Db } from "./services";

export type CheckStatus = "ok" | "down" | "not_configured";

export interface Readiness {
  ok: boolean;
  checks: { database: CheckStatus; storage: CheckStatus };
}

/** Each dependency gets this long; an uptime monitor wants a fast answer, not a hung request. */
export const READINESS_TIMEOUT = Duration.seconds(2);

const status = <E, R>(check: Effect.Effect<unknown, E, R>): Effect.Effect<CheckStatus, never, R> =>
  check.pipe(
    Effect.timeoutFail({ duration: READINESS_TIMEOUT, onTimeout: () => "timeout" as const }),
    Effect.as("ok" as const),
    Effect.orElseSucceed(() => "down" as const),
  );

const database = status(Effect.flatMap(Db, ({ use }) => use((db) => db.execute(sql`select 1`))));

/** Storage is reported but optional: without storage config it is `not_configured`, not down. */
const storage = Effect.option(loadStorageConfig).pipe(
  Effect.flatMap((config) =>
    config._tag === "None"
      ? Effect.succeed("not_configured" as const)
      : status(Effect.tryPromise((signal) => probeBucket(config.value, signal))),
  ),
);

/**
 * Readiness: can this instance serve requests? Database and storage are checked in
 * parallel. Only statuses come back, never error text, hosts or versions.
 */
export const checkReadiness: Effect.Effect<Readiness, never, Db> = Effect.all(
  { database, storage },
  { concurrency: "unbounded" },
).pipe(
  Effect.map((checks) => ({
    ok: checks.database === "ok" && checks.storage !== "down",
    checks,
  })),
);
