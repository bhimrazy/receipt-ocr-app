import type { Sql, TransactionSql } from "postgres";

/**
 * A postgres.js pool behind two guards.
 *
 * The gate: at most `max` queries or transactions are in flight, so postgres.js never
 * pipelines a query onto a busy connection. Through a transaction-mode pooler (Supabase's
 * Supavisor) a pipelined query can lose its reply when the query ahead of it ends its
 * transaction and the pooler hands the backend to someone else; the promise then never
 * settles. Queries inside a transaction skip the gate: they run on the transaction's own
 * connection, which the pooler holds until COMMIT.
 *
 * The deadline: a query that hasn't settled `timeoutMs` after it was sent rejects with
 * `QueryTimeoutError`, and the whole pool is replaced, because postgres.js can't drop the one
 * connection the query is stuck on. The old pool gets `RESET_GRACE_S` to finish its other
 * queries before it is destroyed. Waiting for the gate has the same limit; that timeout keeps
 * the pool unless every permit has also been held that long. A transaction's body is not timed
 * as a whole: its BEGIN, each query, and its COMMIT or ROLLBACK are.
 */
export type GatedPoolOptions = {
  /** Same as the pool's `max`. */
  readonly max: number;
  readonly timeoutMs: number;
};

/** Seconds the replaced pool's other queries get before their connections are closed. */
const RESET_GRACE_S = 5;

export class QueryTimeoutError extends Error {
  override readonly name = "QueryTimeoutError";
  readonly code = "QUERY_TIMEOUT";
  constructor(readonly timeoutMs: number) {
    super(`Database query did not finish within ${timeoutMs} ms`);
  }
}

/** What a query was, without its text or values: safe to log. */
export type QueryLabel = {
  /** `select`, `insert`, `update`, `delete`, `begin`, `commit` (COMMIT or ROLLBACK) or `other`. */
  readonly operation: string;
  /** The first table the statement names, or `unknown`. */
  readonly table: string;
  /** FNV-1a of the statement text (placeholders, never values), to group repeats. */
  readonly statementHash: string;
};

export type PoolEvent = {
  readonly type: "query_timeout";
  /** `queue`: no free connection in time (the pool is kept). `query`: no reply in time (the pool is replaced). */
  readonly phase: "queue" | "query";
  readonly query: QueryLabel;
  readonly timeoutMs: number;
  /** Queries and transactions holding the gate when it fired. */
  readonly inFlight: number;
  /** Callers waiting for the gate when it fired. */
  readonly queued: number;
};

const LISTENERS_KEY = Symbol.for("@receipt-ocr/db/pool-listeners");

/** Process-wide, like the pools: a listener added through one copy of this module hears them all. */
const listeners: Set<(event: PoolEvent) => void> = ((
  globalThis as { [LISTENERS_KEY]?: Set<(event: PoolEvent) => void> }
)[LISTENERS_KEY] ??= new Set());

/** Calls `listener` for every pool event in this process. Returns an unsubscribe function. */
export function onPoolEvent(listener: (event: PoolEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: PoolEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not turn a timeout into a different error.
    }
  }
}

export function labelQuery(statement: string): QueryLabel {
  const text = statement.trim().toLowerCase();
  const verb = /^(with\b[\s\S]*?\)\s*)?(select|insert|update|delete|begin|commit)\b/.exec(
    text,
  )?.[2];
  // The outermost table, not one from a subquery: the match at the shallowest parenthesis depth.
  let table = "unknown";
  let shallowest = Infinity;
  for (const match of text.matchAll(
    /\b(?:from|into|update|join)\s+"?([a-z_][a-z0-9_]*)"?(?:\."?([a-z_][a-z0-9_]*)"?)?/g,
  )) {
    const before = text.slice(0, match.index);
    const depth = before.split("(").length - before.split(")").length;
    if (depth < shallowest) {
      shallowest = depth;
      table = match[2] ?? match[1] ?? "unknown";
    }
  }
  return {
    operation: verb ?? "other",
    table,
    statementHash: fnv1a(statement),
  };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A held permit; `release` is idempotent. */
type Permit = { release(): void };

class Gate {
  private readonly held = new Set<Permit>();
  private readonly waiting: ((permit: Permit) => void)[] = [];
  constructor(private readonly permits: number) {}

  get inFlight() {
    return this.held.size;
  }
  get queued() {
    return this.waiting.length;
  }

  private grant(): Permit {
    let released = false;
    const permit: Permit = {
      release: () => {
        if (released) return;
        released = true;
        this.held.delete(permit);
        const next = this.waiting.shift();
        if (next) next(this.grant());
      },
    };
    this.held.add(permit);
    return permit;
  }

  /** Resolves with a permit, or with null after `timeoutMs` without one. */
  acquire(timeoutMs: number): Promise<Permit | null> {
    if (this.held.size < this.permits) return Promise.resolve(this.grant());
    return new Promise((resolve) => {
      const take = (permit: Permit) => {
        clearTimeout(timer);
        resolve(permit);
      };
      const timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(take), 1);
        resolve(null);
      }, timeoutMs);
      this.waiting.push(take);
    });
  }
}

type Unsafe = Sql["unsafe"];
type Args = Parameters<Unsafe>;

/** postgres.js's own cancel, which returns its promise (`query.cancel()` drops it uncaught). */
type Cancellable = { canceller?: (query: unknown) => Promise<unknown> };

export function gatedPool(make: () => Sql, options: GatedPoolOptions): Sql {
  let current = make();
  const gate = new Gate(options.max);

  const reset = (stuck: Sql) => {
    if (current !== stuck) return;
    const next = make();
    // Drizzle registers its date parsers on the first pool's options; carry them over.
    Object.assign(next.options.parsers, stuck.options.parsers);
    Object.assign(next.options.serializers, stuck.options.serializers);
    current = next;
    stuck.end({ timeout: RESET_GRACE_S }).catch(() => {});
  };

  /** Logs the timeout and builds its error. `statement` is only parsed here, off the hot path. */
  const timeout = (phase: "queue" | "query", statement: string) => {
    emit({
      type: "query_timeout",
      phase,
      query: labelQuery(statement),
      timeoutMs: options.timeoutMs,
      inFlight: gate.inFlight,
      queued: gate.queued,
    });
    return new QueryTimeoutError(options.timeoutMs);
  };

  /**
   * Settles with `query`, or rejects once the deadline passes. On the deadline the query is
   * cancelled server-side (best effort) and its pool replaced.
   */
  const withDeadline = <T>(pool: Sql, statement: string, query: PromiseLike<T>) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const { canceller } = query as Cancellable;
        canceller?.(query).catch(() => {});
        reject(timeout("query", statement));
        reset(pool);
      }, options.timeoutMs);
      query.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  /**
   * A stand-in for postgres.js's lazy query: drizzle calls `.values()` on it, then awaits it.
   * `run` starts the real query on the first `then`.
   */
  const deferred = (run: (values: boolean) => Promise<unknown>) => {
    let values = false;
    let started: Promise<unknown> | undefined;
    const start = () => (started ??= run(values));
    const pending = {
      values() {
        values = true;
        return pending;
      },
      then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return start().then(onFulfilled, onRejected);
      },
      catch(onRejected?: (reason: unknown) => unknown) {
        return start().catch(onRejected);
      },
      finally(onFinally?: () => void) {
        return start().finally(onFinally);
      },
    };
    return pending;
  };

  /** Wraps a transaction's `sql` so its queries keep the deadline but skip the gate. */
  const inTransaction = (pool: Sql, tx: TransactionSql): TransactionSql =>
    new Proxy(tx, {
      get(target, key, receiver) {
        if (key === "unsafe") {
          return (...[query, parameters, queryOptions]: Args) =>
            deferred((values) => {
              const pending = target.unsafe(query, parameters, queryOptions);
              return withDeadline(pool, query, values ? pending.values() : pending);
            });
        }
        if (key === "savepoint") {
          return (...args: unknown[]) => {
            const fn = args.at(-1) as (sql: TransactionSql) => unknown;
            const rest = args.slice(0, -1) as [];
            return target.savepoint(...rest, (sp: TransactionSql) => fn(inTransaction(pool, sp)));
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });

  /**
   * Waits for a permit; throws `QueryTimeoutError` without one in time. The pool is kept: every
   * permit holder is either inside a deadline of its own or in a transaction body running app
   * code, which a new pool wouldn't free.
   */
  const enter = async (statement: string) => {
    const permit = await gate.acquire(options.timeoutMs);
    if (permit) return permit;
    throw timeout("queue", statement);
  };

  const unsafe = (...[query, parameters, queryOptions]: Args) =>
    deferred(async (values) => {
      const permit = await enter(query);
      try {
        const pool = current;
        const pending = pool.unsafe(query, parameters, queryOptions);
        return await withDeadline(pool, query, values ? pending.values() : pending);
      } finally {
        permit.release();
      }
    });

  /** Settles once `body` does, with nothing to report: for races that must not reject. */
  const settledOf = (body: Promise<unknown>) =>
    body.then(
      () => {},
      () => {},
    );

  const begin = async (...args: unknown[]) => {
    const fn = args.at(-1) as (sql: TransactionSql) => unknown;
    const mode = args.length > 1 ? (args[0] as string) : "";
    const permit = await enter("begin");
    try {
      const pool = current;
      let markOpen!: () => void;
      let markDone!: () => void;
      const opened = new Promise<void>((resolve) => (markOpen = resolve));
      const done = new Promise<void>((resolve) => (markDone = resolve));
      const body = pool.begin(mode, (tx) => {
        markOpen();
        const result = fn(inTransaction(pool, tx));
        Promise.resolve(Array.isArray(result) ? Promise.all(result) : result).then(
          markDone,
          markDone,
        );
        return result;
      });
      body.catch(() => {});
      // BEGIN and COMMIT/ROLLBACK run inside postgres.js, out of reach of `unsafe`: time BEGIN
      // until the body starts, and COMMIT or ROLLBACK from when the body settles.
      await withDeadline(pool, "begin", Promise.race([opened, settledOf(body)]));
      await Promise.race([done, settledOf(body)]);
      return await withDeadline(pool, "commit", body);
    } finally {
      permit.release();
    }
  };

  const target = (() => {}) as unknown as Sql;
  return new Proxy(target, {
    get(_target, key) {
      if (key === "unsafe") return unsafe;
      if (key === "begin") return begin;
      const value = Reflect.get(current, key, current) as unknown;
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}
