/**
 * Copy for Settings → Security after connecting Google or GitHub. Better Auth sends the browser
 * back with `?error=<code>`; we add `?link=<provider>` so the message can name it.
 */

const LINK_ERRORS: Record<string, (provider: string, email: string) => string> = {
  email_does_not_match: (provider, email) =>
    `That ${provider} account uses a different email address. Connect one that uses ${email}.`,
  account_already_linked_to_different_user: (provider) =>
    `That ${provider} account already signs in to another ReceiptOCR account.`,
  unable_to_link_account: (provider, email) =>
    `We couldn't connect ${provider}. Check that ${email} is confirmed in your ${provider} account, then try again.`,
  access_denied: (provider) => `Connecting ${provider} was cancelled.`,
};

export function linkErrorMessage(code: string, provider: string, email: string): string {
  const message = LINK_ERRORS[code.toLowerCase()];
  return message ? message(provider, email) : `We couldn't connect ${provider}. Try again.`;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The outcome a `linkSocial` round trip left in the URL, if any. */
export function linkOutcome(
  params: { link?: string | string[]; linked?: string | string[]; error?: string | string[] },
  labels: Record<string, string>,
  email: string,
): { ok: true; message: string } | { ok: false; message: string } | null {
  const linked = first(params.linked);
  if (linked && labels[linked]) return { ok: true, message: `${labels[linked]} is connected.` };
  const link = first(params.link);
  const error = first(params.error);
  if (link && labels[link] && error) {
    return { ok: false, message: linkErrorMessage(error, labels[link], email) };
  }
  return null;
}
