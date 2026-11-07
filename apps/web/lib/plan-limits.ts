import "server-only";
import { DEFAULT_PLAN, DEFAULT_PLANS, Settings, userPlan, type PlanTable } from "@receipt-ocr/core";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { authEnv } from "./env";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";
import { getSession } from "./session";

/**
 * The plan limits an admin saved, or the code defaults when they can't be
 * read (no database at build time, or a database error).
 */
export async function getPlanTable(): Promise<PlanTable> {
  if (!authEnv.databaseUrl) return DEFAULT_PLANS;
  try {
    return await runtime.runPromise(
      Effect.flatMap(Settings, (settings) => settings.plans).pipe(Effect.timeout("3 seconds")),
    );
  } catch (error) {
    logger.error({ event: "plans.read_failed", error: errorFields(error) });
    return DEFAULT_PLANS;
  }
}

/**
 * The signed-in user's plan and limits, read from the database on each
 * request so an admin's plan change applies at once. Deduplicated per request.
 */
export const getCurrentPlan = cache(async () => {
  const session = await getSession();
  if (!session) return { plan: DEFAULT_PLAN, policy: DEFAULT_PLANS[DEFAULT_PLAN] };
  return runtime.runPromise(userPlan(session.user.id));
});

/** Pages that print a plan limit and are cached between requests. */
const PLAN_COPY_PAGES = [
  "/terms",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/account-deleted",
] as const;

/** Call after saving plan limits, so cached pages show the new numbers. */
export function revalidatePlanCopy() {
  for (const path of PLAN_COPY_PAGES) revalidatePath(path);
  revalidatePath("/accept-invitation/[id]", "page");
}
