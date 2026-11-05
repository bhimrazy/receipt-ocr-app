import { describe, expect, it } from "vitest";
import { escapeHtml, invitationEmail, passwordResetEmail } from "./templates";

const hostileName =
  'Acme</strong></p><h1 style="color:red">Your account is locked</h1><p><a href="https://evil.example/login">Verify</a></p>';

describe("invitationEmail", () => {
  const mail = invitationEmail({
    organizationName: hostileName,
    inviterEmail: "b<script>@example.com",
    url: "https://app.example/accept-invitation/abc",
  });

  it("escapes the workspace name and inviter in the HTML body", () => {
    expect(mail.html).not.toContain("<h1 style=\"color:red\">");
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
