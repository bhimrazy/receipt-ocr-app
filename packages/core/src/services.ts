import { createDb, type DbClient } from "@receipt-ocr/db";
import { deleteObjects, getObject, putObject, signedGetUrl } from "@receipt-ocr/storage";
import { Context, Effect, Layer, Redacted } from "effect";
import { DatabaseUrl, loadStorageConfig } from "./config";
import { DbError, NotConfigured, StorageError } from "./errors";
import { logger } from "./telemetry/logger";
import { errorFields } from "./telemetry/redact";

/**
 * Logs `db.pool_error` for an idle client the server dropped (a database restart, a socket that
 * died while a serverless instance was suspended). The pool has already removed the client.
 * `createPool` attaches a silent listener, so this is the second one; attached once per pool.
 */
function logPoolErrors(client: DbClient) {
  const pool = client.$client;
  if (pool.listenerCount("error") > 1) return;
  pool.on("error", (error) =>
    logger.error({ event: "db.pool_error", unit: "log", error: errorFields(error) }),
  );
}

export class Db extends Context.Tag("@receipt-ocr/core/Db")<
  Db,
  {
    readonly client: DbClient;
    /** Runs a Drizzle query, turning a rejection into a typed DbError. */
    readonly use: <A>(query: (db: DbClient) => Promise<A>) => Effect.Effect<A, DbError>;
  }
>() {
  static readonly Live = Layer.effect(
    Db,
    DatabaseUrl.pipe(
      Effect.mapError(
        (cause) =>
          new NotConfigured({
            message: "DATABASE_URL is not configured",
            cause,
          }),
      ),
      Effect.map((url) => {
        const client = createDb(Redacted.value(url));
        logPoolErrors(client);
        return {
          client,
          use: <A>(query: (db: DbClient) => Promise<A>) =>
            Effect.tryPromise({
              try: () => query(client),
              catch: (cause) => new DbError({ message: "Database request failed", cause }),
            }),
        };
      }),
    ),
  );
}

type StorageFailure = StorageError | NotConfigured;

export class Storage extends Context.Tag("@receipt-ocr/core/Storage")<
  Storage,
  {
    readonly put: (
      key: string,
      body: Uint8Array,
      contentType: string,
    ) => Effect.Effect<void, StorageFailure>;
    readonly get: (key: string) => Effect.Effect<Uint8Array, StorageFailure>;
    readonly remove: (keys: readonly string[]) => Effect.Effect<void, StorageFailure>;
    readonly signedUrl: (key: string) => Effect.Effect<string, StorageFailure>;
  }
>() {
  static readonly Live = Layer.succeed(Storage, {
    put: (key, body, contentType) =>
      call("Failed to store the receipt file", (config, signal) =>
        putObject(config, { key, body, contentType }, signal),
      ),
    get: (key) =>
      call("Failed to read the receipt file", (config, signal) => getObject(config, key, signal)),
    remove: (keys) =>
      keys.length === 0
        ? Effect.void
        : call("Failed to delete the receipt file", (config, signal) =>
            deleteObjects(config, keys, signal),
          ),
    signedUrl: (key) =>
      call("Failed to sign the receipt image URL", (config) => signedGetUrl(config, key)),
  });
}

/** Config is read per call so a missing bucket only fails storage operations. */
const call = <A>(
  message: string,
  run: (config: Effect.Effect.Success<typeof loadStorageConfig>, signal: AbortSignal) => Promise<A>,
) =>
  Effect.flatMap(loadStorageConfig, (config) =>
    Effect.tryPromise({
      // The signal aborts the request when the fiber is interrupted (a timeout).
      try: (signal) => run(config, signal),
      catch: (cause) => new StorageError({ message, cause }),
    }),
  );
