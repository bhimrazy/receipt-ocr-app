"use client";

import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. Uses only public configuration — the base URL is
 * inferred from the current origin, so no server secrets leak client-side.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient(), adminClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
