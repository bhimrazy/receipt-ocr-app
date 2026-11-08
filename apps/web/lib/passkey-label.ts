import { getAuthenticatorName } from "@better-auth/passkey";

/**
 * What a passkey is called on the Security page and in the added/removed emails: the user's
 * name for it, else the authenticator model, else "Passkey".
 */
export const passkeyLabel = (key: { name?: string | null; aaguid?: string | null }) =>
  key.name?.trim() || getAuthenticatorName(key.aaguid) || "Passkey";
