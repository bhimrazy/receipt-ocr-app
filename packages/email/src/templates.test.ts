import { describe, expect, it } from "vitest";
import {
  deleteAccountEmail,
  displayUrl,
  emailChangeNoticeEmail,
  escapeHtml,
  formatDuration,
  invitationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  supportMessageEmail,
  testEmail,
  verificationEmail,
  type EmailContent,
} from "./templates";

const ctx = { appUrl: "https://app.example", supportEmail: "help@app.example" };
const token = "tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const link = { url: `https://app.example/api/auth/verify?token=${token}`, expiresInSeconds: 3600 };

const hostileName =
  'Acme</strong></p><h1 style="color:red">Your account is locked</h1><p><a href="https://evil.example/login">Verify</a></p>';

const all: Record<string, () => Promise<EmailContent>> = {
  verification: () => verificationEmail(ctx, link),
  passwordReset: () => passwordResetEmail(ctx, link),
  invitation: () =>
    invitationEmail(ctx, {
      organizationName: "Acme",
      inviterEmail: "b@example.com",
      url: "https://app.example/accept-invitation/abc",
      expiresInSeconds: 604800,
    }),
  supportMessage: () =>
    supportMessageEmail(ctx, { from: "v@example.com", topicLabel: "Question", message: "Hi" }),
  test: () => testEmail(ctx),
  deleteAccount: () => deleteAccountEmail(ctx, link),
  passwordChanged: () => passwordChangedEmail(ctx),
  emailChangeNotice: () => emailChangeNoticeEmail(ctx, { newEmail: "new@example.com" }),
};

describe.each(Object.entries(all))("%s email", (_name, make) => {
  it("has the layout's structure, dark-mode support and a hidden preheader", async () => {
    const { html } = await make();
    expect(html).toContain('<html dir="ltr" lang="en">');
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark"/>');
    expect(html).toContain("@media (prefers-color-scheme:dark)");
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    // Every layout table is presentational.
    const tables = html.match(/<table[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table).toContain('role="presentation"');
    // The preheader is the first thing in the body and hidden.
    expect(html).toMatch(/<body[^>]*>(<!--[^>]*-->)*<div style="display:none;[^"]*"[^>]*>\S/);
  });

  it("links only to absolute URLs, loads only the hosted PNG logo, and has no tracking pixel", async () => {
    const { html } = await make();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^(https:\/\/app\.example\/|mailto:)/);
    const images = html.match(/<img[^>]*>/g) ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('src="https://app.example/icons/icon-192.png"');
    expect(images[0]).toMatch(/width="32"/);
    expect(images[0]).toMatch(/height="32"/);
    expect(images[0]).toMatch(/alt=""/);
  });

  it("has a plain-text part with the footer and no markup", async () => {
    const { text, subject } = await make();
    expect(subject).toContain("receiptOCR");
    expect(text).toMatch(/^receiptOCR\n/);
    expect(text).toContain("Privacy: https://app.example/privacy");
    expect(text).not.toMatch(/<[a-z]/i);
  });
});

describe("link emails", () => {
  it("give the full URL in plain text but only a short, token-free label in HTML", async () => {
    const { html, text } = await verificationEmail(ctx, link);
    expect(text).toContain(link.url);
    expect(html).toContain(`href="${escapeHtml(link.url)}"`);
    // The token only appears in the two hrefs (button and fallback link), never as visible text.
    expect(html.split(token)).toHaveLength(3);
    expect(html).toContain(">app.example/api/auth/verify<");
    expect(html).not.toMatch(new RegExp(`>[^<]*${token}`));
  });

  it("quote the configured lifetime", async () => {
    expect((await passwordResetEmail(ctx, link)).text).toContain("expires in 1 hour");
    expect((await all.invitation()).html).toContain("expires in 7 days");
  });

  it("say what to do if you didn't ask, and where support is", async () => {
    const { html, text } = await verificationEmail(ctx, link);
    expect(text).toContain("Didn't sign up? You can ignore this email.");
    expect(html).toContain('href="mailto:help@app.example"');
  });

  it("refuse a non-http link", async () => {
    await expect(verificationEmail(ctx, { ...link, url: "javascript:alert(1)" })).rejects.toThrow();
  });
});

describe("invitationEmail", () => {
  const mail = () =>
    invitationEmail(ctx, {
      organizationName: hostileName,
      inviterEmail: "b<script>@example.com",
      url: "https://app.example/accept-invitation/abc",
      expiresInSeconds: 604800,
    });

  it("escapes the workspace name and inviter in the HTML body", async () => {
    const { html } = await mail();
    expect(html).not.toContain('<h1 style="color:red">');
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain("&lt;h1 style=&quot;color:red&quot;&gt;");
    expect(html).toContain("b&lt;script&gt;@example.com");
    // Only the layout's own heading remains.
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("uses a fixed subject and preheader with no user text", async () => {
    const { subject, html } = await mail();
    expect(subject).toBe("You're invited to a receiptOCR workspace");
    expect(html).toContain(">Accept within 7 days to share receipts in this workspace.<");
  });

  it("keeps user text to one line in the plain-text part", async () => {
    const { text } = await invitationEmail(ctx, {
      organizationName: "Acme\r\n\r\nYour account is locked\u0007",
      inviterEmail: "b@example.com",
      url: "https://app.example/x",
      expiresInSeconds: 604800,
    });
    expect(text).toContain('"Acme Your account is locked"');
  });
});

describe("supportMessageEmail", () => {
  it("escapes the visitor's message and address", async () => {
    const { html, subject } = await supportMessageEmail(ctx, {
      from: 'x"><img src=x>@example.com',
      topicLabel: "Question",
      message: hostileName,
    });
    expect(subject).toBe("[receiptOCR support] Question");
    expect(html).not.toContain('<h1 style="color:red">');
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;h1 style=&quot;color:red&quot;&gt;");
  });
});

describe("emailChangeNoticeEmail", () => {
  it("escapes the new address", async () => {
    const { html } = await emailChangeNoticeEmail(ctx, { newEmail: "<b>x</b>@example.com" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;@example.com");
  });
});

describe("helpers", () => {
  it("escapeHtml escapes markup and both quote styles", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });

  it("attribute-escapes CTA URLs", async () => {
    const { html } = await passwordResetEmail(ctx, {
      url: 'https://app.example/r?a=1&b="2"',
      expiresInSeconds: 3600,
    });
    expect(html).toContain('href="https://app.example/r?a=1&amp;b=%222%22"');
  });

  it("displayUrl drops the query and long paths, keeping the host", () => {
    expect(displayUrl("https://app.example/a?token=secret")).toBe("app.example/a");
    expect(displayUrl(`https://app.example/reset/${token}`)).toBe("app.example/…");
  });

  it("formatDuration reads naturally", () => {
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(7200)).toBe("2 hours");
    expect(formatDuration(604800)).toBe("7 days");
    expect(formatDuration(900)).toBe("15 minutes");
  });
});
