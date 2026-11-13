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
  /** Which template made this message; `sendEmail` logs it as `email_kind`. */
  kind: TemplateName;
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
    kind: name,
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
  input: { senderName: string; from: string; topicLabel: string; message: string },
): EmailContent {
  return build("supportMessage", `[${BRAND} support] ${input.topicLabel}`, ctx, input);
}

const MAX_FIRST_NAME = 30;
// Link-like: a scheme, "www.", an address, a path, or a dot followed by letters ("x.com").
const LINK_LIKE = /:\/\/|www\.|@|\/|\\|\.\p{L}{2}/iu;
// Kept: letters, combining marks, apostrophes, hyphens and dots ("O'Neil", "Jean-Luc", "J.").
const NOT_NAME_CHAR = /[^\p{L}\p{M}'’.-]/gu;

/**
 * The first name a contact-form auto-reply greets, from what the visitor typed: letters only, at
 * most 30 characters, and "there" when nothing usable is left or it looks like a link (an
 * auto-reply can be aimed at anyone's address, so it must not carry a stranger's URL).
 */
export function greetingName(raw: string): string {
  const first =
    raw
      .normalize("NFKC")
      .trim()
      .split(/[\s\p{Cc}\p{Cf}]+/u)[0] ?? "";
  if (LINK_LIKE.test(first)) return "there";
  const name = first
    .replace(NOT_NAME_CHAR, "")
    .replace(/^[.'’-]+|[.'’-]+$/gu, "")
    .slice(0, MAX_FIRST_NAME);
  return /\p{L}/u.test(name) ? name : "there";
}

/**
 * The automatic "we got your message" to a contact-form sender. `topicPhrase` comes from the
 * app's fixed list; the name is cleaned here whatever the caller passes.
 */
export function contactReplyEmail(
  ctx: EmailContext,
  input: { name: string; topicPhrase: string },
): EmailContent {
  return build("contactReply", `Thanks for contacting ${BRAND}`, ctx, {
    firstName: greetingName(input.name),
    topicPhrase: input.topicPhrase,
  });
}

/** Double opt-in mail for product updates; `unsubscribeUrl` lets a wrong recipient opt out for good. */
export function newsletterConfirmEmail(
  ctx: EmailContext,
  input: LinkEmailInput & { unsubscribeUrl: string },
): EmailContent {
  return build("newsletterConfirm", `Confirm your ${BRAND} product updates`, ctx, {
    ...link(input),
    unsubscribeUrl: input.unsubscribeUrl,
  });
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

/** The step-up code for an account with no second factor; never in the subject. */
export function stepUpCodeEmail(
  ctx: EmailContext,
  input: { code: string; expiresInSeconds: number },
): EmailContent {
  return build("stepUpCode", `Your ${BRAND} verification code`, ctx, {
    code: input.code,
    expiry: formatDuration(input.expiresInSeconds),
  });
}

/** Security notices for sign-in factor changes; each links the password reset page. */
type Notice = (ctx: EmailContext, input: { resetUrl: string }) => EmailContent;

export const twoFactorEnabledEmail: Notice = (ctx, input) =>
  build("twoFactorEnabled", `Two-step sign-in is on for your ${BRAND} account`, ctx, input);

/** Turned off by the user, or reset by an administrator (who also signed them out everywhere). */
export function twoFactorDisabledEmail(
  ctx: EmailContext,
  input: { resetUrl: string; byAdmin: boolean },
): EmailContent {
  return input.byAdmin
    ? build("twoFactorReset", `Two-step sign-in was reset on your ${BRAND} account`, ctx, {
        resetUrl: input.resetUrl,
      })
    : build("twoFactorDisabled", `Two-step sign-in is off for your ${BRAND} account`, ctx, {
        resetUrl: input.resetUrl,
      });
}

export const backupCodesRegeneratedEmail: Notice = (ctx, input) =>
  build("backupCodesRegenerated", `New backup codes for your ${BRAND} account`, ctx, input);

/** `passkeyName` is what the Security page calls it: user-chosen text, so body only, never the subject. */
type PasskeyNotice = (
  ctx: EmailContext,
  input: { resetUrl: string; passkeyName: string },
) => EmailContent;

export const passkeyAddedEmail: PasskeyNotice = (ctx, input) =>
  build("passkeyAdded", `A passkey was added to your ${BRAND} account`, ctx, input);

export const passkeyRemovedEmail: PasskeyNotice = (ctx, input) =>
  build("passkeyRemoved", `A passkey was removed from your ${BRAND} account`, ctx, input);

/** An account that signed in only with Google or GitHub set a password. */
export const passwordSetEmail: Notice = (ctx, input) =>
  build("passwordSet", `A password was added to your ${BRAND} account`, ctx, input);

/** `provider` is the app's fixed label, never user input. */
type ProviderNotice = (
  ctx: EmailContext,
  input: { resetUrl: string; provider: "Google" | "GitHub" },
) => EmailContent;

export const signInConnectedEmail: ProviderNotice = (ctx, input) =>
  build(
    "signInConnected",
    `${input.provider} sign-in was connected to your ${BRAND} account`,
    ctx,
    input,
  );

export const signInDisconnectedEmail: ProviderNotice = (ctx, input) =>
  build(
    "signInDisconnected",
    `${input.provider} sign-in was disconnected from your ${BRAND} account`,
    ctx,
    input,
  );
/**
 * Sent once to a new account. `planLine` states the user's plan and its limits, worded by the
 * caller from the plan table when sending, so no number is written here. The link is the upload
 * page.
 */
export function welcomeEmail(ctx: EmailContext, input: { planLine: string }): EmailContent {
  return build("welcome", `Welcome to ${BRAND}`, ctx, {
    url: new URL("/app/upload", ctx.appUrl).toString(),
    planLine: input.planLine,
  });
}
