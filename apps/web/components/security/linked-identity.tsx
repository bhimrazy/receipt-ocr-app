import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { errorFields, logger } from "@/lib/log";

const TIMEOUT_MS = 2_000;

/** The provider's view of a linked account, or null when it fails or takes too long. */
async function accountInfo(accountId: string, provider: string, requestHeaders: Headers) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      auth.api.accountInfo({ query: { accountId }, headers: requestHeaders }),
      timeout,
    ]);
  } catch (error) {
    logger.info({
      event: "auth.account_info_failed",
      unit: "log",
      kind: provider,
      error: errorFields(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The connected Google address or GitHub username, asked of the provider with the stored token
 * (Better Auth's account-info). Streamed, so a slow or failed provider never holds up the page.
 */
export async function LinkedIdentity({
  accountId,
  provider,
}: {
  accountId: string;
  provider: "google" | "github";
}) {
  const info = await accountInfo(accountId, provider, await headers());
  const login =
    provider === "github" ? (info?.data as { login?: unknown } | undefined)?.login : null;
  const label =
    typeof login === "string" && login
      ? `@${login}`
      : (info?.user.email ?? info?.user.name ?? null);
  return <span>{label || "Account details aren't available right now."}</span>;
}
