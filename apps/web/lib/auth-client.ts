"use client";

import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { clearSharedFiles } from "./share-target";
import { clearSignedInHint } from "./signed-in-hint";

/**
 * Browser auth client. Uses only public configuration — the base URL is
 * inferred from the current origin, so no server secrets leak client-side.
 */
export const authClient = createAuthClient({
  // No twoFactorPage: the sign-in form routes to /sign-in/two-factor itself.
  plugins: [organizationClient(), adminClient(), twoFactorClient(), passkeyClient()],
});

/** Signs out and drops the landing-page hint cookie and any receipts shared to the app. */
export async function signOutAndClearHint() {
  await authClient.signOut();
  clearSignedInHint();
  await clearSharedFiles();
}

export const { signIn, signUp, signOut, useSession } = authClient;
