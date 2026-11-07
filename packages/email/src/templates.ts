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

export { absoluteUrl, isEmailAddress, displayUrl, escapeHtml, formatDuration } from "./render";

export const BRAND = "ReceiptOCR";

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
  for (const [name, value] of Object.entries(values)) {
    // Links go out under our trusted sender, so they stay on the app's own origin.
    if (SLOT_KINDS[name as SlotName] === "url" && new URL(value).origin !== values.appOrigin) {
      throw new Error(`Email link ${name} must be on ${values.appOrigin}`);
    }
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
export function deleteAccountEmail(
  ctx: EmailContext,
  input: LinkEmailInput & { resetUrl: string },
): EmailContent {
  return build("deleteAccount", `Confirm deleting your ${BRAND} account`, ctx, {
    ...link(input),
    resetUrl: input.resetUrl,
  });
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
  input: LinkEmailInput & { currentEmail: string; newEmail: string; resetUrl: string },
): EmailContent {
  return build("emailChange", `Approve your ${BRAND} email change`, ctx, {
    ...link(input),
    currentEmail: input.currentEmail,
    newEmail: input.newEmail,
    resetUrl: input.resetUrl,
  });
}
