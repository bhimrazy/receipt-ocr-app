import "server-only";
import { loadCheckoutConfig, workspaceBilling } from "@receipt-ocr/core";
import { Effect } from "effect";
import { cache } from "react";
import { authEnv } from "./env";
import { runtime } from "./runtime";

/**
 * Paddle's public checkout settings, or null while billing is off (any
 * PADDLE_* setting missing). Env only, so marketing pages can read it.
 */
export const getCheckoutConfig = cache(() => Effect.runPromise(loadCheckoutConfig));

/** The active workspace's subscription for the billing page, or null without one. */
export const getWorkspaceBilling = cache(async (organizationId: string) =>
  authEnv.databaseUrl ? runtime.runPromise(workspaceBilling(organizationId)) : null,
);

/** Only a workspace's owners may buy or manage its plan; admins and members see it read-only. */
export const canManageBilling = (role: string) => role === "owner";
