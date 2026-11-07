/** The base32 key in an `otpauth://` URI, for "can't scan? enter this key". */
export function totpKeyFromUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "otpauth:") return null;
    return url.searchParams.get("secret")?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

/** Groups of four, easier to copy by hand. */
export const formatTotpKey = (key: string) => key.match(/.{1,4}/g)?.join(" ") ?? key;

/** The text of the backup-codes download. */
export function backupCodesText(codes: readonly string[], email: string, date = new Date()) {
  return [
    "receiptOCR backup codes",
    `Account: ${email}`,
    `Created: ${date.toISOString().slice(0, 10)}`,
    "",
    "Each code works once, when you can't use your authenticator app.",
    "",
    ...codes,
    "",
  ].join("\n");
}
