/**
 * The app's pg pool against real Postgres, directly and through a TCP proxy that misbehaves two
 * ways: `release` drops the server's replies after each ReadyForQuery(idle) until the client
 * writes again, the way a transaction-mode pooler hands its backend on once a transaction ends
 * (the 2026-11-09 incident); `freeze` forwards nothing, like a dead socket.
 * Skipped unless INTEGRATION=1 (scripts/test.sh and CI set DATABASE_URL).
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "./index";

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

/** Drizzle wraps driver errors; pg's own error is the cause. */
const cause = (error: unknown) => (error as { cause?: unknown }).cause;

/** Every message along an error's cause chain. */
const messages = (error: unknown): string[] => {
  const out: string[] = [];
  for (let e = error; e instanceof Error; e = (e as { cause?: unknown }).cause) out.push(e.message);
  return out;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!enabled)("pg pool (integration)", () => {
  const direct = process.env.DATABASE_URL ?? "postgres://localhost/none";
  const proxy = faultProxy(new URL(direct));
  let proxied = "";
  const pools: pg.Pool[] = [];
  const open = (url: string, options: Parameters<typeof createPool>[1]) => {
    const pool = createPool(url, options);
    pools.push(pool);
    return pool;
  };

  beforeAll(async () => {
    const url = new URL(direct);
    url.hostname = "127.0.0.1";
    url.port = String(await proxy.listen());
    proxied = url.toString();
  });

  afterEach(async () => {
    proxy.setMode("pass");
    await Promise.all(pools.splice(0).map((pool) => pool.end().catch(() => {})));
  });

  afterAll(() => proxy.close());

  it("answers every query when far more run at once than the pool has connections, through a transaction-pooler model", async () => {
    const db = drizzle(open(proxied, { max: 2, queryTimeoutMs: 5_000 }));
    proxy.setMode("release");
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        i % 2
          ? db.execute<{ n: number }>(sql`select ${i}::int as n`)
          : db.execute<{ n: number }>(sql.raw(`select ${i} as n`)),
      ),
    );
    expect(results.map((r) => r.rows[0]!.n)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("fails a query on a dead socket within query_timeout, and the pool works afterwards", async () => {
    const db = drizzle(open(proxied, { max: 2, queryTimeoutMs: 400 }));
    await db.execute(sql`select 1`);
    proxy.setMode("freeze");
    const started = Date.now();
    const error = await db.execute(sql`select ${1}::int`).catch((e: unknown) => e);
    expect((cause(error) as Error).message).toBe("Query read timeout");
    expect(Date.now() - started).toBeLessThan(1_500);
    proxy.setMode("pass");
    await expect(db.execute<{ n: number }>(sql`select ${7}::int as n`)).resolves.toMatchObject({
      rows: [{ n: 7 }],
    });
  });

  it("closes a transaction's client whose statement outlasts query_timeout, so it is never reused", async () => {
    const pool = open(direct, { max: 1, queryTimeoutMs: 300 });
    const db = drizzle(pool);
    let pid = 0;
    const error = await db
      .transaction(async (tx) => {
        const rows = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        pid = rows.rows[0]!.pid;
        await tx.execute(sql`select pg_sleep(1)`);
      })
      .catch((e: unknown) => e);
    // drizzle reports its failed ROLLBACK; the client makes that fail with the timeout itself.
    expect(messages(error)).toContain("Query read timeout");
    expect(messages(error)).not.toContain("Client was closed and is not queryable");
    expect(pid).toBeGreaterThan(0);

    // With max 1, any reuse of that client would show its pid (and its open transaction).
    const pids = new Set<number>();
    for (let i = 0; i < 3; i++) {
      const rows = await db.execute<{ pid: number; tx: string }>(
        sql`select pg_backend_pid() as pid, current_setting('transaction_isolation') as tx`,
      );
      pids.add(rows.rows[0]!.pid);
    }
    expect(pids.has(pid)).toBe(false);

    // The server ends the abandoned session once its sleep returns and it finds the client gone.
    await pause(1_200);
    const check = drizzle(open(direct, { max: 1 }));
    const left = await check.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where pid = ${pid}`,
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it("a session the server ends mid-transaction fails that transaction, not the process", async () => {
    const uncaught: unknown[] = [];
    const record = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", record);
    try {
      const db = drizzle(open(direct, { max: 1, queryTimeoutMs: 5_000 }));
      const error = await db
        .transaction(async (tx) => {
          await tx.execute(sql`set local idle_in_transaction_session_timeout = '300ms'`);
          await pause(1_200);
          await tx.execute(sql`select 1`);
        })
        .catch((e: unknown) => e);
      expect(messages(error)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^(Connection terminated unexpectedly|Client has encountered a connection error and is not queryable)$/,
          ),
        ]),
      );
      await pause(100);
      expect(uncaught).toEqual([]);
      await expect(db.execute<{ n: number }>(sql`select ${9}::int as n`)).resolves.toMatchObject({
        rows: [{ n: 9 }],
      });
    } finally {
      process.off("uncaughtException", record);
    }
  });

  it("bounds the wait for a free client too", async () => {
    const pool = open(direct, { max: 1, queryTimeoutMs: 5_000 });
    const db = drizzle(pool);
    const holding = db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      await pause(11_000);
    });
    await pause(50);
    const started = Date.now();
    const error = await db.execute(sql`select 2`).catch((e: unknown) => e);
    expect(String((cause(error) as Error).message)).toMatch(
      /timeout exceeded when trying to connect/,
    );
    expect(Date.now() - started).toBeLessThan(11_000);
    await holding;
  }, 20_000);
});
