"use server";

import {
  cancelQueuedJob,
  JOB_REGISTRY,
  loadDailyOcrCap,
  rerunJob,
  setQueueControl,
  type AppServices,
} from "@receipt-ocr/core";
import { Cause, Effect, Exit } from "effect";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/http";
import { drainJobs, ROUTE_BUDGET_MS } from "@/lib/jobs";
import { logger } from "@/lib/log";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";

/**
 * Admin actions on the job queue. Each re-checks the admin role (Next also
 * checks the Origin of every server action), validates its input, then makes
 * the change and its audit row in one core transaction.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "That didn't work. Try again, and check the server logs if it keeps failing.";
const SAFE_TAGS = new Set(["InvalidInput", "Conflict", "NotFound"]);

class ActionError extends Error {}

async function context() {
  const session = await requireAdmin();
  return {
    actor: { id: session.user.id, email: session.user.email },
    ip: clientIp({ headers: await headers() }),
  };
}

async function core<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "Some") {
    const error = failure.value as { _tag?: string; message?: string };
    if (error._tag && SAFE_TAGS.has(error._tag) && error.message) {
      throw new ActionError(error.message);
    }
  }
  throw new Error(Cause.pretty(exit.cause));
}

async function run(
  name: string,
  body: (audit: Awaited<ReturnType<typeof context>>) => Promise<void>,
): Promise<ActionResult> {
  const audit = await context(); // outside try: requireAdmin's notFound() must propagate
  try {
    await body(audit);
    return { ok: true };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Check the values and try again." };
    }
    logger.error({
      event: "admin.action_failed",
      action: name,
      error:
        error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    });
    return { ok: false, error: GENERIC };
  }
}

const jobId = z.uuid("That isn't a job id.");
const reason = z
  .string()
  .trim()
  .min(3, "Write a reason (at least 3 characters).")
  .max(500, "Keep the reason under 500 characters.");

function touch(id?: string) {
  revalidatePath("/admin/jobs");
  revalidatePath("/admin/operations");
  if (id) revalidatePath(`/admin/jobs/${id}`);
}

/** Re-queues a dead or cancelled job under its round (no new quota round), then runs the queue. */
export async function rerunJobAction(input: { jobId: string; reason: string }) {
  return run("job.rerun", async (audit) => {
    const parsed = z.object({ jobId, reason }).parse(input);
    const startedAt = Date.now();
    const dailyCap = await core(loadDailyOcrCap);
    await core(
      rerunJob(JOB_REGISTRY, parsed.jobId, audit, {
        reason: parsed.reason,
        ...(dailyCap === undefined ? {} : { dailyCap }),
      }),
    );
    after(() =>
      drainJobs(startedAt + ROUTE_BUDGET_MS, { event: "job.admin_rerun", job_id: parsed.jobId }, [
        parsed.jobId,
      ]),
    );
    touch(parsed.jobId);
  });
}

export async function cancelJobAction(input: { jobId: string; reason: string }) {
  return run("job.cancel", async (audit) => {
    const parsed = z.object({ jobId, reason }).parse(input);
    await core(cancelQueuedJob(JOB_REGISTRY, parsed.jobId, audit, parsed.reason));
    touch(parsed.jobId);
  });
}

/** Pauses or resumes `queue` or `kind:<kind>`; resuming `provider:<id>` clears its cooldown. */
export async function setQueueControlAction(input: {
  scope: string;
  paused: boolean;
  reason: string;
}) {
  return run("job.control", async (audit) => {
    const parsed = z
      .object({ scope: z.string().min(1).max(60), paused: z.boolean(), reason })
      .parse(input);
    await core(setQueueControl(JOB_REGISTRY, parsed, audit));
    touch();
  });
}
