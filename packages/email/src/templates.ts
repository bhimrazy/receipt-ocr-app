/**
 * Transactional messages, filled from the prerendered templates in `generated.ts` (built from
 * `src/emails/*.tsx` by `bun run email:generate`). Subjects are fixed text; the only variable one
 * uses an allowlisted contact topic label.
 */
import { TEMPLATES } from "./generated";
import {
  displayUrl,
  fill,
  formatDuration,
  normalizeSlot,
  SLOT_KINDS,
  type SlotName,
} from "./render";

export { absoluteUrl, displayUrl, escapeHtml, formatDuration } from "./render";

export const BRAND = "receiptOCR";

/** Where the app lives and who answers replies. The web app passes these; this package reads no env. */
export interface EmailContext {
  /** Absolute origin, e.g. https://receipt-ocr.bhimraj.com.np. Links and the logo hang off it. */
  appUrl: string;
  /** Footer and "contact us" lines; without it they point at the in-app support button. */
  supportEmail?: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export type TemplateName = keyof typeof TEMPLATES;

/**
 * The normalized slot values a template is filled with: shared ones from `ctx` plus its own.
 * Exported for the golden tests, which render the React source with the same values.
 */
export function emailSlots(
  ctx: EmailContext,
  input: Partial<Record<SlotName, string>>,
): Record<string, string> {
  const raw: Partial<Record<SlotName, string>> = { ...input, appOrigin: ctx.appUrl };
  if (ctx.supportEmail) raw.supportEmail = ctx.supportEmail;
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw) as [SlotName, string][]) {
    values[name] = normalizeSlot(SLOT_KINDS[name], value);
  }
  values.appHost = new URL(values.appOrigin).host;
  if (values.url) values.urlLabel = displayUrl(values.url);
  if (values.resetUrl) values.resetUrlLabel = displayUrl(values.resetUrl);
  return values;
}

function build(
  name: TemplateName,
  subject: string,
  ctx: EmailContext,
  input: Partial<Record<SlotName, string>>,
): EmailContent {
  const values = emailSlots(ctx, input);
  const template = TEMPLATES[name][values.supportEmail ? "support" : "nosupport"];
  return {
    subject,
    html: fill(template.html, values, "html"),
    text: fill(template.text, values, "text"),
  };
}

export interface LinkEmailInput {
  url: string;
  /** The token lifetime the auth config sets, so the copy can't drift from it. */
  expiresInSeconds: number;
}

const link = ({ url, expiresInSeconds }: LinkEmailInput) => ({
  url,
  expiry: formatDuration(expiresInSeconds),
});

export function verificationEmail(ctx: EmailContext, input: LinkEmailInput): EmailContent {
  return build("verification", `Confirm your ${BRAND} email`, ctx, link(input));
}

export function passwordResetEmail(ctx: EmailContext, input: LinkEmailInput): EmailContent {
  return build("passwordReset", `Reset your ${BRAND} password`, ctx, link(input));
}

/**
 * The subject and preheader are fixed: workspace names and addresses are user input, and the
 * inbox list is where a phishing lure would be read first.
 */
export function invitationEmail(
  ctx: EmailContext,
  input: LinkEmailInput & { organizationName: string; inviterEmail: string },
): EmailContent {
  return build("invitation", `You're invited to a ${BRAND} workspace`, ctx, {
    ...link(input),
    organizationName: input.organizationName,
    inviterEmail: input.inviterEmail,
  });
}

/** A contact-form message to the support inbox; `topicLabel` comes from the app's fixed list. */
export function supportMessageEmail(
  ctx: EmailContext,
  input: { from: string; topicLabel: string; message: string },
): EmailContent {
  return build("supportMessage", `[${BRAND} support] ${input.topicLabel}`, ctx, input);
}

/** The admin console's delivery check. */
export function testEmail(ctx: EmailContext): EmailContent {
  return build("test", `[${BRAND}] Test email`, ctx, {});
}

/** Step-up confirmation before an account is deleted; the link works once. */
export function deleteAccountEmail(ctx: EmailContext, input: LinkEmailInput): EmailContent {
  return build("deleteAccount", `Confirm deleting your ${BRAND} account`, ctx, link(input));
}

/** Security notice after a password change (by the user or an admin). */
export function passwordChangedEmail(ctx: EmailContext, input: { resetUrl: string }): EmailContent {
  return build("passwordChanged", `Your ${BRAND} password was changed`, ctx, input);
}

/**
 * To the current address, which must approve an email change (`url`, Better Auth's approval link)
 * before the new address is sent its own verification. The subject is fixed: the new address is
 * user input.
 */
export function emailChangeEmail(
  ctx: EmailContext,
  input: LinkEmailInput & { newEmail: string; resetUrl: string },
): EmailContent {
  return build("emailChange", `Approve the email change on your ${BRAND} account`, ctx, {
    ...link(input),
    newEmail: input.newEmail,
    resetUrl: input.resetUrl,
  });
}

/** Where to get help in a security notice: the support inbox, else the in-app support form. */
function supportLine(supportEmail: string | undefined) {
  const address = supportEmail ? oneLine(supportEmail) : undefined;
  return {
    html: address
      ? `contact us at <a href="mailto:${escapeHtml(address)}" style="color:#e7e7ea">${escapeHtml(address)}</a>`
      : "contact us from the support button in the app",
    text: address ? `contact us at ${address}` : "contact us from the support button in the app",
  };
}

export function deleteAccountEmail(url: string): EmailContent {
  return {
    subject: `Confirm deleting your ${BRAND} account`,
    html: layout(
      "Confirm deleting your account",
      "<p style='margin:0 0 12px'>Someone signed in to your account asked to delete it. Open this link within 1 hour and confirm on the page it opens to permanently delete the account, its workspaces and every receipt in them. Until then, nothing changes. The link works once.</p><p style='margin:0'>If it wasn't you, don't open the link. Change your password, or the password of the Google or GitHub account you sign in with, because someone else can use your account.</p>",
      { label: "Delete my account", url },
    ),
    text: `Confirm deleting your ${BRAND} account.\n\nOpen this link within 1 hour and confirm on the page it opens to permanently delete the account, its workspaces and every receipt in them. Until then, nothing changes. The link works once:\n${url}\n\nIf it wasn't you, don't open the link. Change your password, or the password of the Google or GitHub account you sign in with, because someone else can use your account.`,
  };
}

export function passwordChangedEmail(params: {
  resetUrl: string;
  supportEmail?: string;
}): EmailContent {
  const support = supportLine(params.supportEmail);
  return {
    subject: `Your ${BRAND} password was changed`,
    html: layout(
      "Your password was changed",
      `<p style='margin:0'>The password for this account was just changed. If that was you, there's nothing to do. If it wasn't you, reset your password now and ${support.html}.</p>`,
      { label: "Reset password", url: params.resetUrl },
    ),
    text: `The password for your ${BRAND} account was just changed.\n\nIf that was you, there's nothing to do. If it wasn't you, reset your password now and ${support.text}:\n${params.resetUrl}`,
  };
}

/** Goes to the current address, which must approve the change before the new one is confirmed. */
export function emailChangeEmail(params: {
  newEmail: string;
  url: string;
  resetUrl: string;
  supportEmail?: string;
}): EmailContent {
  const newEmail = oneLine(params.newEmail);
  const support = supportLine(params.supportEmail);
  const resetUrl = escapeHtml(params.resetUrl);
  // The subject is fixed: the new address is user input.
  return {
    subject: `Approve the email change on your ${BRAND} account`,
    html: layout(
      "Approve the email change",
      `<p style='margin:0 0 12px'>Someone signed in to your account asked to change its email address to <strong style="color:#e7e7ea">${escapeHtml(newEmail)}</strong>. Nothing changes until you approve it with this link and then confirm the new address from the email we send there. The link expires in 1 hour.</p><p style='margin:0'>If it wasn't you, don't open the link. <a href="${resetUrl}" style="color:#e7e7ea">Reset your password</a> and ${support.html}.</p>`,
      { label: "Approve the change", url: params.url },
    ),
    text: `Someone signed in to your ${BRAND} account asked to change its email address to ${newEmail}.\n\nNothing changes until you approve it and then confirm the new address. Approve (expires in 1 hour):\n${params.url}\n\nIf it wasn't you, don't open the link. Reset your password and ${support.text}:\n${params.resetUrl}`,
  };
}
