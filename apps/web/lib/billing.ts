import "server-only";
import {
  loadCheckoutConfig,
  sandboxOnProduction,
  workspaceBilling,
  workspaceCheckoutBlocked,
  type CheckoutConfig,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { cache } from "react";
import { authEnv } from "./env";
import { runtime } from "./runtime";

/**
 * Paddle's public checkout settings, or null while billing is off (any
 * PADDLE_* setting missing). Env only, so marketing pages can read it.
 */
export const getCheckoutConfig = cache(() => Effect.runPromise(loadCheckoutConfig));

/**
 * Sandbox keys on the live site: a checkout would take no real money, so only
 * platform admins see it (marked as a test). Everyone else sees Pro as not open yet.
 */
export const isTestModeOnProduction = (config: CheckoutConfig) =>
  sandboxOnProduction(config.environment, process.env);

/** Whether the public pages (pricing, landing) may offer the checkout. */
export const checkoutOpenToEveryone = (config: CheckoutConfig | null) =>
  config !== null && !isTestModeOnProduction(config);

/**
 * The checkout this viewer may use, or null: billing off, or sandbox on the
 * live site for someone who isn't a platform admin. `testMode` marks a sandbox
 * checkout on the live site.
 */
export async function getCheckoutFor(
  isPlatformAdmin: boolean,
): Promise<{ config: CheckoutConfig; testMode: boolean } | null> {
  const config = await getCheckoutConfig();
  if (!config) return null;
  const testMode = isTestModeOnProduction(config);
  if (testMode && !isPlatformAdmin) return null;
  return { config, testMode };
}

/** The active workspace's subscription for the billing page, or null without one. */
export const getWorkspaceBilling = cache(async (organizationId: string) =>
  authEnv.databaseUrl ? runtime.runPromise(workspaceBilling(organizationId)) : null,
);

/** Whether the workspace has a subscription that can still charge, so no checkout is offered. */
export const getCheckoutBlocked = cache(async (organizationId: string) =>
  authEnv.databaseUrl ? runtime.runPromise(workspaceCheckoutBlocked(organizationId)) : false,
);

/** Only a workspace's owners may buy or manage its plan; admins and members see it read-only. */
export const canManageBilling = (role: string) => role === "owner";
