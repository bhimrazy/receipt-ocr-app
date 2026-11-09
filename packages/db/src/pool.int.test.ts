/**
 * The gated pool against real Postgres, through a TCP proxy that can misbehave the two ways a
 * connection to Supabase's pooler can: `release` drops the server's replies after each
 * ReadyForQuery(idle) until the client writes again, the way a transaction-mode pooler hands
 * the backend on once a transaction ends; `freeze` forwards nothing, like a dead socket.
 * Skipped unless INTEGRATION=1 (scripts/test.sh sets DATABASE_URL).
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { gatedPool, onPoolEvent, QueryTimeoutError, type PoolEvent } from "./pool";

const enabled = process.env.INTEGRATION === "1";

type Mode = "pass" | "release" | "freeze";

function faultProxy(target: URL) {
  let mode: Mode = "pass";
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    sockets.add(client).add(upstream);
    let attached = true;
    let pending: Buffer = Buffer.alloc(0);
    client.on("data", (chunk) => {
      if (mode === "freeze") return;
      attached = true;
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (mode === "freeze") return;
      pending = Buffer.concat([pending, chunk as Buffer]);
      // Whole backend messages only: a type byte and an int32 length that counts itself.
      while (pending.length >= 5) {
        const length = pending.readInt32BE(1) + 1;
        if (pending.length < length) break;
        const message = pending.subarray(0, length);
        pending = pending.subarray(length);
        if (attached || mode === "pass") client.write(message);
        if (mode === "release" && message[0] === 0x5a && message[5] === 0x49) attached = false;
      }
    });
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", close).on("error", close);
    upstream.on("close", close).on("error", close);
  });
  return {
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
      ),
    setMode: (next: Mode) => (mode = next),
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Starts `query` now; resolves to how it ended within `ms`: `ok`, `error` or `pending`. */
const outcome = (query: PromiseLike<unknown>, ms: number) =>
  Promise.race([
    Promise.resolve(query).then(
      () => "ok",
      () => "error",
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);

/** Drizzle wraps driver errors; the pool's own error is the cause. */
const cause = (error: unknown) => (error as { cause?: unknown }).cause;

describe.skipIf(!enabled)("gated pool (integration)", () => {
  const target = new URL(process.env.DATABASE_URL ?? "postgres://localhost/none");
  const proxy = faultProxy(target);
  let url = "";
  const opened: postgres.Sql[] = [];
  const make = (max: number) => () => {
    const pool = postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 5 });
    opened.push(pool);
    return pool;
  };

  beforeAll(async () => {
    const port = await proxy.listen();
    const proxied = new URL(target);
    proxied.hostname = "127.0.0.1";
    proxied.port = String(port);
    url = proxied.toString();
  });

  afterEach(async () => {
    proxy.setMode("pass");
    await Promise.all(opened.splice(0).map((pool) => pool.end({ timeout: 0 })));
  });

  afterAll(() => proxy.close());

  it("reproduces the hang: plain postgres.js pipelines onto a busy connection and loses the reply", async () => {
    const pool = make(1)();
    await pool`select 1`;
    proxy.setMode("release");
    const first = outcome(pool.unsafe("select pg_sleep(0.2)"), 2_000);
    const second = outcome(pool.unsafe("select $1::int as n", [2]), 2_000);
    expect(await first).toBe("ok");
    expect(await second).toBe("pending");
  });

  it("the gate keeps the same two queries off one connection, so both answer", async () => {
    const pool = gatedPool(make(1), { max: 1, timeoutMs: 5_000 });
    await pool.unsafe("select 1");
    proxy.setMode("release");
    const first = outcome(pool.unsafe("select pg_sleep(0.2)"), 2_000);
    const second = pool.unsafe("select $1::int as n", [2]);
    expect(await first).toBe("ok");
    await expect(second).resolves.toEqual([{ n: 2 }]);
  });

  it("many parallel reads through a smaller pool all answer", async () => {
    const pool = gatedPool(make(3), { max: 3, timeoutMs: 5_000 });
    proxy.setMode("release");
    const rows = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 ? pool.unsafe("select $1::int as n", [i]) : pool.unsafe(`select ${i} as n`),
      ),
    );
    expect(rows.map((r) => (r as unknown as { n: number }[])[0]!.n)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    );
  });

  it("a dead socket ends in QueryTimeoutError, an event, and a fresh pool that works", async () => {
    const events: PoolEvent[] = [];
    const stop = onPoolEvent((event) => events.push(event));
    try {
      const pool = gatedPool(make(2), { max: 2, timeoutMs: 400 });
      await pool.unsafe("select 1");
      proxy.setMode("freeze");
      const started = Date.now();
      await expect(
        pool.unsafe("select * from pg_class where oid = $1", [1]),
      ).rejects.toBeInstanceOf(QueryTimeoutError);
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(events).toEqual([
        expect.objectContaining({
          type: "query_timeout",
          phase: "query",
          timeoutMs: 400,
          query: expect.objectContaining({ operation: "select", table: "pg_class" }),
        }),
      ]);
      proxy.setMode("pass");
      await expect(pool.unsafe("select $1::int as n", [7])).resolves.toEqual([{ n: 7 }]);
      expect(opened).toHaveLength(2);
    } finally {
      stop();
    }
  });

  it("drizzle transactions run their queries without waiting on the gate they hold", async () => {
    const db = drizzle(gatedPool(make(1), { max: 1, timeoutMs: 2_000 }));
    const outside = db.execute(sql`select 1 as n`);
    const inside = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7301, 1)`);
      const rows = await tx.execute(sql`select ${5}::int as n`);
      return rows[0];
    });
    expect(inside).toEqual({ n: 5 });
    await expect(outside).resolves.toEqual([{ n: 1 }]);
  });

  it("waiting too long for a connection fails without replacing the pool", async () => {
    const events: PoolEvent[] = [];
    const stop = onPoolEvent((event) => events.push(event));
    try {
      const db = drizzle(gatedPool(make(1), { max: 1, timeoutMs: 300 }));
      const holding = db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        await new Promise((resolve) => setTimeout(resolve, 700));
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const error = await db.execute(sql`select 2`).catch((e: unknown) => e);
      expect(cause(error)).toBeInstanceOf(QueryTimeoutError);
      await holding;
      expect(events.map((e) => e.phase)).toEqual(["queue"]);
      expect(opened).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("a COMMIT that never answers fails the transaction and replaces the pool", async () => {
    const events: PoolEvent[] = [];
    const stop = onPoolEvent((event) => events.push(event));
    try {
      const db = drizzle(gatedPool(make(1), { max: 1, timeoutMs: 400 }));
      const started = Date.now();
      const error = await db
        .transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          proxy.setMode("freeze");
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QueryTimeoutError);
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(events).toEqual([
        expect.objectContaining({
          phase: "query",
          query: expect.objectContaining({ operation: "commit" }),
        }),
      ]);
      proxy.setMode("pass");
      await expect(db.execute(sql`select 3 as n`)).resolves.toEqual([{ n: 3 }]);
      expect(opened).toHaveLength(2);
    } finally {
      stop();
    }
  });

  it("a ROLLBACK that never answers is timed the same way", async () => {
    const db = drizzle(gatedPool(make(1), { max: 1, timeoutMs: 400 }));
    const error = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        proxy.setMode("freeze");
        throw new Error("body failed");
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueryTimeoutError);
    proxy.setMode("pass");
    await expect(db.execute(sql`select 4 as n`)).resolves.toEqual([{ n: 4 }]);
  });

  it("asks the server to stop a statement that outlived the deadline", async () => {
    const direct = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const pool = gatedPool(make(1), { max: 1, timeoutMs: 300 });
      const error = await pool
        .unsafe("select pg_sleep(5), 'incident-cancel-probe'")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QueryTimeoutError);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const running = await direct`select count(*)::int as n from pg_stat_activity
        where state = 'active' and query like '%incident-cancel-probe%' and pid <> pg_backend_pid()`;
      expect(running[0]!.n).toBe(0);
    } finally {
      await direct.end({ timeout: 0 });
    }
  });

  it("keeps drizzle's parsers after the pool is replaced", async () => {
    const db = drizzle(gatedPool(make(1), { max: 1, timeoutMs: 300 }));
    const before = await db.execute<{ t: unknown }>(sql`select now() as t`);
    proxy.setMode("freeze");
    const error = await db.execute(sql`select 1`).catch((e: unknown) => e);
    expect(cause(error)).toBeInstanceOf(QueryTimeoutError);
    proxy.setMode("pass");
    const after = await db.execute<{ t: unknown }>(sql`select now() as t`);
    expect(typeof after[0]!.t).toBe(typeof before[0]!.t);
    expect(opened).toHaveLength(2);
  });
});
