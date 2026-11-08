import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { Job } from "../definition";
import { JOB_REGISTRY } from "../registry";
import { contactReply, ContactReplyMailer, contactReplyPayload } from "./contact-reply";

const payload = { to: "a@example.com", name: "Ada", topic: "feature" };

const run = (
  outcome: "delivered" | "not_configured" | "failed" | "rejected",
  sent: unknown[] = [],
) =>
  Effect.runPromiseExit(
    contactReply.run(payload, { job: { id: "j" } as Job, attempt: 1, worker: "w" }).pipe(
      Effect.provide(
        Layer.succeed(ContactReplyMailer, {
          send: (input) => {
            sent.push(input);
            return Effect.succeed(outcome);
          },
        }),
      ),
    ),
  );

describe("contact auto-reply job", () => {
  it("is registered and validates its payload", () => {
    expect(JOB_REGISTRY["email.contact-reply"]).toBe(contactReply);
    expect(contactReplyPayload.safeParse(payload).success).toBe(true);
    expect(contactReplyPayload.safeParse({ to: "a@example.com", topic: "x" }).success).toBe(false);
    expect(contactReplyPayload.safeParse({ ...payload, to: "not an address" }).success).toBe(false);
    expect(contactReplyPayload.safeParse({ ...payload, name: "x".repeat(81) }).success).toBe(false);
  });

  it("hands the payload to the mailer once", async () => {
    const sent: unknown[] = [];
    const exit = await run("delivered", sent);
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ delivered: true });
    expect(sent).toEqual([payload]);
  });

  it("succeeds without a mailer, retries a failed send and gives up on a bad render", async () => {
    expect(Exit.isSuccess(await run("not_configured"))).toBe(true);
    const failed = await run("failed");
    expect(JSON.stringify(failed)).toContain("email-send-failed");
    expect(JSON.stringify(failed)).toContain("RetryableJobError");
    expect(JSON.stringify(await run("rejected"))).toContain("NonRetryableJobError");
  });
});
