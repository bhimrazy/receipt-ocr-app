/**
 * Plain, dependency-free HTML. Email clients ignore most modern CSS, so these
 * stay table-free, inline-styled, and readable as plain text when the HTML
 * part is stripped.
 */

const BRAND = "receiptOCR";

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

/** `heading` and `cta` are text and are escaped here; `bodyHtml` is markup the caller escaped. */
function layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const h = escapeHtml(heading);
  const label = cta ? escapeHtml(cta.label) : "";
  const url = cta ? escapeHtml(cta.url) : "";
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e7e7ea">
    <div style="max-width:520px;margin:0 auto;background:#141416;border:1px solid #26262b;border-radius:16px;padding:32px">
      <p style="margin:0 0 24px;font-size:15px;font-weight:600;letter-spacing:-0.01em">${BRAND}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600">${h}</h1>
      <div style="font-size:15px;line-height:1.6;color:#a1a1aa">${bodyHtml}</div>
      ${
        cta
          ? `<p style="margin:28px 0 0">
               <a href="${url}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:500">${label}</a>
             </p>
             <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#71717a;word-break:break-all">
               Or paste this into your browser:<br />${url}
             </p>`
          : ""
      }
    </div>
  </body>
</html>`;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function passwordResetEmail(url: string): EmailContent {
  return {
    subject: `Reset your ${BRAND} password`,
    html: layout(
      "Reset your password",
      "<p style='margin:0'>Someone asked to reset the password for this account. This link expires in one hour. If it wasn't you, you can ignore this email — nothing changes until the link is used.</p>",
      { label: "Reset password", url },
    ),
    text: `Reset your ${BRAND} password.\n\nThis link expires in one hour:\n${url}\n\nIf you didn't request this, ignore this email.`,
  };
}

export function verificationEmail(url: string): EmailContent {
  return {
    subject: `Confirm your ${BRAND} email`,
    html: layout(
      "Confirm your email",
      "<p style='margin:0'>Confirm this address to finish setting up your account.</p>",
      { label: "Confirm email", url },
    ),
    text: `Confirm your ${BRAND} email address:\n${url}`,
  };
}

export function invitationEmail(params: {
  organizationName: string;
  inviterEmail: string;
  url: string;
}): EmailContent {
  const organizationName = oneLine(params.organizationName);
  const inviterEmail = oneLine(params.inviterEmail);
  const { url } = params;
  // The subject is fixed: workspace names and addresses are user input, and a
  // subject line is where a phishing lure would be read first.
  return {
    subject: `You're invited to a ${BRAND} workspace`,
    html: layout(
      "You're invited to a workspace",
      `<p style='margin:0'><strong style="color:#e7e7ea">${escapeHtml(inviterEmail)}</strong> invited you to the <strong style="color:#e7e7ea">${escapeHtml(organizationName)}</strong> workspace on ${BRAND}. This invitation expires in 7 days.</p>`,
      { label: "Accept invitation", url },
    ),
    text: `${inviterEmail} invited you to join the "${organizationName}" workspace on ${BRAND}.\n\nAccept (expires in 7 days):\n${url}`,
  };
}

const SECURITY_FOOTER =
  "If this wasn't you, reset your password now and contact support by replying to this email.";

/** The step-up code for users without a second factor. The code is never in the subject. */
export function stepUpCodeEmail(code: string): EmailContent {
  const safe = escapeHtml(code);
  return {
    subject: `Your ${BRAND} verification code`,
    html: layout(
      "Confirm it's you",
      `<p style='margin:0 0 16px'>Enter this code to finish what you started in ${BRAND}. It expires in 10 minutes and works once.</p>
       <p style="margin:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:0.2em;color:#e7e7ea">${safe}</p>
       <p style='margin:0'>Never share this code. We will never ask you for it. If you didn't ask for it, someone may know your password: change it.</p>`,
    ),
    text: `Your ${BRAND} verification code: ${code}\n\nIt expires in 10 minutes and works once. Never share it. If you didn't ask for it, change your password.`,
  };
}

export function twoFactorEnabledEmail(): EmailContent {
  return {
    subject: `Two-step sign-in is on for your ${BRAND} account`,
    html: layout(
      "Two-step sign-in is on",
      `<p style='margin:0 0 16px'>An authenticator app was added to your account. Signing in with your password now also asks for a code from that app.</p><p style='margin:0'>${SECURITY_FOOTER}</p>`,
    ),
    text: `An authenticator app was added to your ${BRAND} account. Signing in with your password now also asks for a code from it.\n\n${SECURITY_FOOTER}`,
  };
}

/** Turned off by the user, or reset by an administrator (who also signed them out everywhere). */
export function twoFactorDisabledEmail({ byAdmin }: { byAdmin: boolean }): EmailContent {
  const what = byAdmin
    ? "An administrator reset two-step sign-in on your account, removing your authenticator app and passkeys, usually because you asked for help after losing them. You've been signed out everywhere; sign in with your password and set them up again in Settings → Security."
    : "Two-step sign-in was turned off for your account. Signing in now only needs your password.";
  return {
    subject: byAdmin
      ? `Two-step sign-in was reset on your ${BRAND} account`
      : `Two-step sign-in is off for your ${BRAND} account`,
    html: layout(
      byAdmin ? "Two-step sign-in was reset" : "Two-step sign-in is off",
      `<p style='margin:0 0 16px'>${escapeHtml(what)}</p><p style='margin:0'>${SECURITY_FOOTER}</p>`,
    ),
    text: `${what}\n\n${SECURITY_FOOTER}`,
  };
}

export function backupCodesRegeneratedEmail(): EmailContent {
  return {
    subject: `New backup codes for your ${BRAND} account`,
    html: layout(
      "New backup codes",
      `<p style='margin:0 0 16px'>New backup codes were created for your account. The old ones no longer work.</p><p style='margin:0'>${SECURITY_FOOTER}</p>`,
    ),
    text: `New backup codes were created for your ${BRAND} account. The old ones no longer work.\n\n${SECURITY_FOOTER}`,
  };
}

export function passkeyAddedEmail(): EmailContent {
  return {
    subject: `A passkey was added to your ${BRAND} account`,
    html: layout(
      "New passkey added",
      `<p style='margin:0 0 16px'>A passkey was added to your account. It can now sign you in and confirm important changes.</p><p style='margin:0'>${SECURITY_FOOTER}</p>`,
    ),
    text: `A passkey was added to your ${BRAND} account. It can now sign you in and confirm important changes.\n\n${SECURITY_FOOTER}`,
  };
}

export function passkeyRemovedEmail(): EmailContent {
  return {
    subject: `A passkey was removed from your ${BRAND} account`,
    html: layout(
      "Passkey removed",
      `<p style='margin:0 0 16px'>A passkey was removed from your account and can no longer sign you in.</p><p style='margin:0'>${SECURITY_FOOTER}</p>`,
    ),
    text: `A passkey was removed from your ${BRAND} account and can no longer sign you in.\n\n${SECURITY_FOOTER}`,
  };
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
