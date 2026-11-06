"use client";

import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { clearSignedInHint } from "./signed-in-hint";

/**
 * Browser auth client. Uses only public configuration — the base URL is
 * inferred from the current origin, so no server secrets leak client-side.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient(), adminClient()],
});

/** Signs out and drops the landing-page hint cookie in one step. */
export async function signOutAndClearHint() {
  await authClient.signOut();
  clearSignedInHint();
}

export const { signIn, signUp, signOut, useSession } = authClient;
