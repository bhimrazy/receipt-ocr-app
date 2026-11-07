/**
 * Every message follows one format (see docs/architecture/email.md): logo and wordmark, one
 * heading, a short body, at most one primary action with its expiry and a short fallback link,
 * a "wasn't you?" note where it matters, and a footer saying why the mail came and where replies go.
 * React escapes every interpolated value in the HTML; plain-text parts collapse user text to one line.
 */
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import {
  Action,
  appLinks,
  BRAND,
  Layout,
  Note,
  P,
  plainText,
  Strong,
  type EmailContext,
} from "./layout";

export { BRAND, absoluteUrl, displayUrl, type EmailContext } from "./layout";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Escapes text for HTML element content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapses control characters and runs of whitespace, so text can't add lines to a plain-text mail. */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
}

/** 3600 -> "1 hour", 604800 -> "7 days". */
export function formatDuration(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}

async function build(subject: string, element: ReactElement, text: string): Promise<EmailContent> {
  return { subject, html: await render(element), text };
}

export interface LinkEmailInput {
  url: string;
  /** The token lifetime the auth config sets, so the copy can't drift from it. */
  expiresInSeconds: number;
}

export async function verificationEmail(ctx: EmailContext, input: LinkEmailInput) {
  const heading = "Confirm your email address";
  const body = `Thanks for signing up for ${BRAND}. Confirm this is your address to finish setting up your account.`;
  const action = {
    label: "Confirm email address",
    url: input.url,
    expiry: `This link expires in ${formatDuration(input.expiresInSeconds)}.`,
  };
  const note = "Didn't sign up? You can ignore this email. Nothing happens without this link.";
  const reason = `You're receiving this because this address was used to create a ${BRAND} account.`;
  return build(
    `Confirm your ${BRAND} email`,
    <Layout
      ctx={ctx}
      preheader={`One step left: confirm your address to start using ${BRAND}.`}
      heading={heading}
      reason={reason}
    >
      <P>{body}</P>
      <Action {...action} />
      <Note>{note}</Note>
    </Layout>,
    plainText(ctx, { heading, body: [body], action, note, reason }),
  );
}

export async function passwordResetEmail(ctx: EmailContext, input: LinkEmailInput) {
  const heading = "Reset your password";
  const body = `We got a request to reset the password for your ${BRAND} account. Choose a new one with the button below.`;
  const expires = formatDuration(input.expiresInSeconds);
  const action = {
    label: "Choose a new password",
    url: input.url,
    expiry: `This link expires in ${expires}. Resetting signs you out on every device.`,
  };
  const note =
    "Didn't ask for this? Ignore this email. Your password stays the same unless this link is used.";
  const reason = `You're receiving this because a password reset was requested for this address.`;
  return build(
    `Reset your ${BRAND} password`,
    <Layout
      ctx={ctx}
      preheader={`Use this link within ${expires} to choose a new password.`}
      heading={heading}
      reason={reason}
    >
      <P>{body}</P>
      <Action {...action} />
      <Note>{note}</Note>
    </Layout>,
    plainText(ctx, { heading, body: [body], action, note, reason }),
  );
}

export async function invitationEmail(
  ctx: EmailContext,
  params: { organizationName: string; inviterEmail: string; url: string; expiresInSeconds: number },
) {
  const organizationName = oneLine(params.organizationName);
  const inviterEmail = oneLine(params.inviterEmail);
  const expires = formatDuration(params.expiresInSeconds);
  const heading = "You're invited to a workspace";
  const action = {
    label: "Accept invitation",
    url: params.url,
    expiry: `This invitation expires in ${expires}. Sign in or sign up with this email address to accept it.`,
  };
  const note = "Not expecting this? You can ignore it. You won't join unless you accept.";
  const reason = `You're receiving this because a ${BRAND} workspace member invited this address.`;
  // Subject and preheader are fixed: workspace names and addresses are user input, and the inbox
  // list is where a phishing lure would be read first.
  return build(
    `You're invited to a ${BRAND} workspace`,
    <Layout
      ctx={ctx}
      preheader={`Accept within ${expires} to share receipts in this workspace.`}
      heading={heading}
      reason={reason}
    >
      <P>
        <Strong>{inviterEmail}</Strong> invited you to join the <Strong>{organizationName}</Strong>{" "}
        workspace on {BRAND}, to upload and review receipts together.
      </P>
      <Action {...action} />
      <Note>{note}</Note>
    </Layout>,
    plainText(ctx, {
      heading,
      body: [
        `${inviterEmail} invited you to join the "${organizationName}" workspace on ${BRAND}, to upload and review receipts together.`,
      ],
      action,
      note,
      reason,
    }),
  );
}

/** A contact-form message to the support inbox. The visitor is the Reply-To, so the footer says so. */
export async function supportMessageEmail(
  ctx: EmailContext,
  params: { from: string; topicLabel: string; message: string },
) {
  const from = oneLine(params.from);
  const heading = `${params.topicLabel} from the contact form`;
  const reason = `Sent by the contact form on ${appLinks(ctx).host}.`;
  const replyNote = `Reply to this email to answer ${from} directly.`;
  return build(
    `[${BRAND} support] ${params.topicLabel}`,
    <Layout
      ctx={ctx}
      preheader={`${params.topicLabel} from ${from}`}
      heading={heading}
      reason={reason}
      replyNote={replyNote}
    >
      <P>
        From <Strong>{from}</Strong>
      </P>
      <Note>
        <span className="whitespace-pre-wrap">{params.message}</span>
      </Note>
    </Layout>,
    plainText(ctx, {
      heading,
      body: [`From ${from}`, params.message],
      reason,
      replyNote,
    }),
  );
}

/** The admin console's delivery check. */
export async function testEmail(ctx: EmailContext) {
  const heading = "Email delivery works";
  const body = `This test was sent from the ${BRAND} admin console. Because it arrived, sign-up confirmations, password resets and invitations can reach people too.`;
  const reason = "You're receiving this because you sent a test from the admin console.";
  return build(
    `[${BRAND}] Test email`,
    <Layout
      ctx={ctx}
      preheader="Your test message arrived, so transactional email is working."
      heading={heading}
      reason={reason}
    >
      <P>{body}</P>
    </Layout>,
    plainText(ctx, { heading, body: [body], reason }),
  );
}

/** Step-up confirmation before an account is deleted. */
export async function deleteAccountEmail(ctx: EmailContext, input: LinkEmailInput) {
  const heading = "Confirm account deletion";
  const body = `You asked to delete your ${BRAND} account. This permanently removes your receipts, their images and the workspaces you own. It can't be undone.`;
  const expires = formatDuration(input.expiresInSeconds);
  const action = {
    label: "Delete my account",
    url: input.url,
    expiry: `This link expires in ${expires}.`,
  };
  const note =
    "Didn't ask for this? Don't open the link, and your account stays as it is. Someone may know your password, so change it and reply to let us know.";
  const reason = `You're receiving this because account deletion was requested for this address.`;
  return build(
    `Confirm deleting your ${BRAND} account`,
    <Layout
      ctx={ctx}
      preheader={`Confirm within ${expires} to permanently delete your account.`}
      heading={heading}
      reason={reason}
    >
      <P>{body}</P>
      <Action {...action} />
      <Note>{note}</Note>
    </Layout>,
    plainText(ctx, { heading, body: [body], action, note, reason }),
  );
}

/** Security notice after a password change; the action is the "wasn't you?" recovery path. */
export async function passwordChangedEmail(ctx: EmailContext) {
  const heading = "Your password was changed";
  const body = `The password for your ${BRAND} account was just changed. If that was you, there's nothing else to do.`;
  const action = { label: "Reset your password", url: `${appLinks(ctx).origin}/forgot-password` };
  const wasntYou = `Wasn't you? Reset your password now, then reply to this email${ctx.supportEmail ? ` or write to ${ctx.supportEmail}` : ""} so we can help secure your account.`;
  const reason = `You're receiving this because the password for this ${BRAND} account changed.`;
  return build(
    `Your ${BRAND} password was changed`,
    <Layout
      ctx={ctx}
      preheader="If this wasn't you, reset your password now."
      heading={heading}
      reason={reason}
    >
      <P>{body}</P>
      <Note className="mb-6">{wasntYou}</Note>
      <Action {...action} />
    </Layout>,
    plainText(ctx, { heading, body: [body, wasntYou], action, reason }),
  );
}

/** Notice to the OLD address when the sign-in email is being changed. */
export async function emailChangeNoticeEmail(ctx: EmailContext, params: { newEmail: string }) {
  const newEmail = oneLine(params.newEmail);
  const heading = "Your sign-in email is changing";
  const action = { label: "Reset your password", url: `${appLinks(ctx).origin}/forgot-password` };
  const wasntYou = `Wasn't you? Reset your password now, then reply to this email${ctx.supportEmail ? ` or write to ${ctx.supportEmail}` : ""} so we can stop the change.`;
  const reason = `You're receiving this because this address is the current sign-in email for a ${BRAND} account.`;
  return build(
    `Your ${BRAND} sign-in email is changing`,
    <Layout
      ctx={ctx}
      preheader="If you didn't ask for this change, reset your password now."
      heading={heading}
      reason={reason}
    >
      <P>
        Someone asked to change the sign-in email for your {BRAND} account to{" "}
        <Strong>{newEmail}</Strong>. {"If that was you, there's nothing else to do."}
      </P>
      <Note className="mb-6">{wasntYou}</Note>
      <Action {...action} />
    </Layout>,
    plainText(ctx, {
      heading,
      body: [
        `Someone asked to change the sign-in email for your ${BRAND} account to ${newEmail}. If that was you, there's nothing else to do.`,
        wasntYou,
      ],
      action,
      reason,
    }),
  );
}
