import { Effect, FiberRef } from "effect";
import { globalValue } from "effect/GlobalValue";
import type { WideEvent, WideEventFields } from "./schema";

/**
 * The wide event of the unit of work the fiber is running for, or null. Set
 * by whoever owns the unit (`runRoute`, the job runner) with `withWideEvent`;
 * code deeper down adds to it with `annotateEvent` instead of logging lines
 * of its own or passing a logger around. Child fibers inherit it.
 */
export const CurrentWideEvent = globalValue(Symbol.for("@receipt-ocr/core/CurrentWideEvent"), () =>
  FiberRef.unsafeMake<WideEvent | null>(null),
);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Merges `fields` into `event`; nested groups (`ocr`, `timings_ms`, ...) merge one level deep. */
export function mergeFields(event: WideEventFields, fields: WideEventFields): void {
  const target = event as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const current = target[key];
    target[key] =
      isPlainObject(current) && isPlainObject(value) ? { ...current, ...value } : value;
  }
}

/** Adds fields to the current wide event. A no-op outside one. */
export const annotateEvent = (fields: WideEventFields): Effect.Effect<void> =>
  Effect.flatMap(FiberRef.get(CurrentWideEvent), (event) =>
    event ? Effect.sync(() => mergeFields(event, fields)) : Effect.void,
  );

/** Runs `self` with `event` as its current wide event. */
export const withWideEvent =
  (event: WideEvent) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.locally(self, CurrentWideEvent, event);
