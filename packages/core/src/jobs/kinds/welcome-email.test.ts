import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "../../plans";
import { Db } from "../../services";
import { Settings } from "../../settings";
import type { Job } from "../definition";
import { JOB_REGISTRY } from "../registry";
import { welcomeEmail, WelcomeMailer, welcomeEmailPayload } from "./welcome-email";

/** A Db whose queries answer from `rows`, in call order: the user row, then the account plan row. */
const fakeDb = (rows: unknown[][]) => {
  const queue = [...rows];
  return Layer.succeed(Db, {
    client: {} as never,
    use: (() => Effect.succeed(queue.shift() ?? [])) as never,
  });
};

const fakeSettings = Layer.succeed(Settings, { plans: Effect.succeed(DEFAULT_PLANS) } as never);

const run = (
  rows: unknown[][],
  send: (input: {
    to: string;
    receiptsPerDay: number;
  }) => "delivered" | "not_configured" | "failed" | "rejected",
  sent: unknown[] = [],
) =>
  Effect.runPromiseExit(
    welcomeEmail.run({ userId: "u1" }, { job: { id: "j" } as Job, attempt: 1, worker: "w" }).pipe(
      Effect.provide(
        Layer.mergeAll(
          fakeDb(rows),
          fakeSettings,
          Layer.succeed(WelcomeMailer, {
            send: (input) => {
              sent.push(input);
              return Effect.succeed(send(input));
            },
          }),
        ),
      ),
    ),
  );

describe("welcome email job", () => {
  it("is registered and validates its payload", () => {
    expect(JOB_REGISTRY["email.welcome"]).toBe(welcomeEmail);
    expect(welcomeEmailPayload.safeParse({ userId: "u1" }).success).toBe(true);
    expect(welcomeEmailPayload.safeParse({}).success).toBe(false);
  });

  it("sends the plan's daily limit read at send time, not a fixed number", async () => {
    for (const [plan, limit] of [
      ["free", DEFAULT_PLANS.free.receiptsPerDay],
      ["pro", DEFAULT_PLANS.pro.receiptsPerDay],
    ] as const) {
      const sent: unknown[] = [];
      // The second query is accountPlan: Pro when comped or owning a Pro workspace.
      const exit = await run(
        [[{ email: "a@example.com" }], [{ pro: plan === "pro" }]],
        () => "delivered",
        sent,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(sent).toEqual([{ to: "a@example.com", receiptsPerDay: limit }]);
    }
    expect(DEFAULT_PLANS.free.receiptsPerDay).not.toBe(DEFAULT_PLANS.pro.receiptsPerDay);
  });

  it("skips a user who has been deleted", async () => {
    const sent: unknown[] = [];
    const exit = await run([[]], () => "delivered", sent);
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ kind: "skipped", reason: "user-gone" });
    expect(sent).toEqual([]);
  });

  it("does not retry when no mailer is configured, and retries a failed send", async () => {
    const rows = () => [[{ email: "a@example.com" }], [{ pro: false }]];
    const unconfigured = await run(rows(), () => "not_configured");
    expect(Exit.isSuccess(unconfigured)).toBe(true);
    const failed = await run(rows(), () => "failed");
    expect(Exit.isFailure(failed)).toBe(true);
    expect(JSON.stringify(failed)).toContain("email-send-failed");
    const rejected = await run(rows(), () => "rejected");
    expect(JSON.stringify(rejected)).toContain("NonRetryableJobError");
  });
});
