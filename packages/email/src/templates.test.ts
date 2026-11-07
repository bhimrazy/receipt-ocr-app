import { describe, expect, it } from "vitest";
import {
  deleteAccountEmail,
  emailChangeEmail,
  escapeHtml,
  invitationEmail,
  passwordChangedEmail,
  passwordResetEmail,
} from "./templates";

const hostileName =
  'Acme</strong></p><h1 style="color:red">Your account is locked</h1><p><a href="https://evil.example/login">Verify</a></p>';

describe("invitationEmail", () => {
  const mail = invitationEmail({
    organizationName: hostileName,
    inviterEmail: "b<script>@example.com",
    url: "https://app.example/accept-invitation/abc",
  });

  it("escapes the workspace name and inviter in the HTML body", () => {
    expect(mail.html).not.toContain('<h1 style="color:red">');
    expect(mail.html).not.toContain('href="https://evil.example');
    expect(mail.html).toContain("&lt;h1 style=&quot;color:red&quot;&gt;");
    expect(mail.html).toContain("b&lt;script&gt;@example.com");
    // Only the layout's own heading and link remain.
    expect(mail.html.match(/<h1/g)).toHaveLength(1);
    expect(mail.html.match(/<a /g)).toHaveLength(1);
  });

  it("uses a fixed subject with no user text", () => {
    expect(mail.subject).toBe("You're invited to a receiptOCR workspace");
  });

  it("keeps user text to one line in the plain-text part", () => {
    const text = invitationEmail({
      organizationName: "Acme\r\n\r\nYour account is locked\u0007",
      inviterEmail: "b@example.com",
      url: "https://app.example/x",
    }).text;
    expect(text).toContain('"Acme Your account is locked"');
  });
});

describe("escapeHtml", () => {
  it("escapes markup and both quote styles", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });

  it("is applied to CTA URLs", () => {
    expect(passwordResetEmail('https://app.example/r?a=1&b="2"').html).toContain(
      'href="https://app.example/r?a=1&amp;b=&quot;2&quot;"',
    );
  });
});

describe("security notices", () => {
  it("links the delete confirmation page and says nothing changes until the user confirms there", () => {
    const mail = deleteAccountEmail("https://app.example/app/settings/delete-account?token=abc");
    expect(mail.html).toContain('href="https://app.example/app/settings/delete-account?token=abc"');
    expect(mail.text).toContain("https://app.example/app/settings/delete-account?token=abc");
    expect(mail.text).toMatch(/within 1 hour and confirm on the page it opens/);
    expect(mail.text).toContain("Until then, nothing changes. The link works once");
  });

  it("points a password change notice at the reset page and the support inbox", () => {
    const mail = passwordChangedEmail({
      resetUrl: "https://app.example/forgot-password",
      supportEmail: "help@example.com",
    });
    expect(mail.subject).toBe("Your receiptOCR password was changed");
    expect(mail.html).toContain('href="https://app.example/forgot-password"');
    expect(mail.html).toContain('href="mailto:help@example.com"');
    expect(mail.text).toContain("contact us at help@example.com");
  });

  it("falls back to the in-app support form without a support inbox", () => {
    const mail = passwordChangedEmail({ resetUrl: "https://app.example/forgot-password" });
    expect(mail.html).not.toContain("mailto:");
    expect(mail.text).toContain("support button in the app");
  });

  it("escapes the requested address in the email change notice and keeps the subject fixed", () => {
    const mail = emailChangeEmail({
      newEmail: '"><h1>locked</h1>@evil.example\r\nBcc: x',
      url: "https://app.example/api/auth/verify-email?token=t",
      resetUrl: "https://app.example/forgot-password",
    });
    expect(mail.subject).toBe("Approve the email change on your receiptOCR account");
    expect(mail.html).not.toContain("<h1>locked");
    expect(mail.html.match(/<h1/g)).toHaveLength(1);
    expect(mail.html).toContain('href="https://app.example/forgot-password"');
    expect(mail.text).not.toMatch(/\r|\n\s*Bcc/);
  });
});
