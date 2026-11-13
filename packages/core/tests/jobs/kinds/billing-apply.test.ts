import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { PaddleApiError, type PaddleErrorCode } from "../../../src/billing/paddle";
import { Billing, providerFailure } from "../../../src/billing/service";
import { NotConfigured } from "../../../src/errors";
import { withWideEvent } from "../../../src/telemetry/current";
import { WideEventLoggerLive } from "../../../src/telemetry/logger";
import type { WideEvent } from "../../../src/telemetry/schema";
import { backoffMs } from "../../../src/jobs/backoff";
import {
  billingApply,
  cancelRevoked,
  LOCKED_RETRY_MS,
} from "../../../src/jobs/kinds/billing-apply";

const unused = () => Effect.die("not used");

/** Runs the cancel against a provider that answers `status` with `code`, or succeeds. */
const cancelWith = (
  answer: { status: number; code?: PaddleErrorCode } | "ok" | "off",
  wide: WideEvent = { event: "job.attempt" },
) =>
  Effect.runPromiseExit(
    cancelRevoked("sub_1").pipe(
      withWideEvent(wide),
      Effect.provide(WideEventLoggerLive),
      Effect.provide(
        Layer.succeed(Billing, {
          receiveWebhook: unused,
          portalLinks: unused,
          createCheckout: unused,
          cancelNow: () =>
            answer === "ok"
              ? Effect.void
              : answer === "off"
                ? Effect.fail(new NotConfigured({ message: "off" }))
                : Effect.fail(
                    providerFailure(
                      "Paddle cancel request failed",
                      new PaddleApiError(answer.status, "status", answer.code ?? null),
                    ),
                  ),
        }),
      ),
    ),
  );

const failure = (exit: Exit.Exit<void, unknown>) =>
  Exit.isFailure(exit) ? Option.getOrNull(Cause.failureOption(exit.cause)) : null;

describe("cancelRevoked", () => {
  it("retries while Paddle has the subscription locked", async () => {
    for (const answer of [
      { status: 409 },
      { status: 400, code: "subscription_locked_renewal" as const },
      { status: 400, code: "subscription_locked_processing" as const },
      { status: 400, code: "subscription_locked_pending_changes" as const },
    ]) {
      expect(failure(await cancelWith(answer))).toMatchObject({
        _tag: "RetryableJobError",
        kind: "provider-locked",
        retryAfterMs: LOCKED_RETRY_MS,
      });
    }
  });

  it("keeps retrying a locked subscription for over an hour before the job gives up", () => {
    const { maxAttempts, backoff } = billingApply;
    expect(backoff.capMs).toBeGreaterThanOrEqual(LOCKED_RETRY_MS);
    // Each of the retries waits at least the floor, whatever the jitter.
    const shortest = Array.from({ length: maxAttempts - 1 }, (_, i) =>
      backoffMs(i + 1, backoff, LOCKED_RETRY_MS, () => 0),
    ).reduce((a, b) => a + b, 0);
    expect(shortest).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it("stops on a refused key or billing off, and is done on another 4xx about the subscription", async () => {
    expect(failure(await cancelWith({ status: 403 }))).toMatchObject({
      _tag: "NonRetryableJobError",
      kind: "provider-auth",
    });
    expect(failure(await cancelWith("off"))).toMatchObject({
      _tag: "NonRetryableJobError",
      kind: "billing-off",
    });
    const canceled = await cancelWith({
      status: 400,
      code: "subscription_is_canceled_action_invalid",
    });
    expect(Exit.isSuccess(canceled)).toBe(true);
    expect(Exit.isSuccess(await cancelWith("ok"))).toBe(true);
  });

  it("notes an already canceled subscription at info, and another refusal at error", async () => {
    const canceled: WideEvent = { event: "job.attempt" };
    await cancelWith({ status: 400, code: "subscription_is_canceled_action_invalid" }, canceled);
    expect(canceled.notices).toEqual(["billing.cancel_already_canceled"]);
    expect(canceled.level).toBeUndefined();

    const refused: WideEvent = { event: "job.attempt" };
    await cancelWith({ status: 404, code: "not_found" }, refused);
    expect(refused).toMatchObject({ notices: ["billing.cancel_refused"], level: "error" });
  });

  it("retries a rate limit or a server error", async () => {
    for (const status of [429, 500]) {
      expect(failure(await cancelWith({ status }))).toMatchObject({
        _tag: "RetryableJobError",
        kind: "provider-error",
      });
    }
  });
});
