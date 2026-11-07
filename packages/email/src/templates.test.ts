import { describe, expect, it } from "vitest";
import {
  backupCodesRegeneratedEmail,
  escapeHtml,
  invitationEmail,
  passwordResetEmail,
  stepUpCodeEmail,
  twoFactorDisabledEmail,
  twoFactorEnabledEmail,
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

describe("security emails", () => {
  it("puts the step-up code in the body only, escaped", () => {
    const mail = stepUpCodeEmail("123456");
    expect(mail.subject).not.toContain("123456");
    expect(mail.text).toContain("123456");
    expect(mail.html).toContain("123456");
    expect(mail.text).toContain("10 minutes");
    expect(stepUpCodeEmail("<b>").html).toContain("&lt;b&gt;");
  });

  it("tells the user how to react to a change they didn't make", () => {
    for (const mail of [
      twoFactorEnabledEmail(),
      twoFactorDisabledEmail({ byAdmin: false }),
      backupCodesRegeneratedEmail(),
    ]) {
      expect(mail.text).toContain("If this wasn't you");
      expect(mail.html.match(/<a /g)).toBeNull();
    }
  });

  it("says when an administrator made the reset", () => {
    expect(twoFactorDisabledEmail({ byAdmin: true }).subject).toContain("was reset");
    expect(twoFactorDisabledEmail({ byAdmin: true }).text).toContain("signed out everywhere");
    expect(twoFactorDisabledEmail({ byAdmin: false }).subject).toContain("is off");
  });
});
