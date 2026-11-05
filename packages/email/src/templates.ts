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
  // eslint-disable-next-line no-control-regex
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
