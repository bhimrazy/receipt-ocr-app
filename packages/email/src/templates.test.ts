import { describe, expect, it } from "vitest";
import { checkSlots, prerenderAll, renderSource } from "./emails/prerender";
import { TEMPLATES } from "./generated";
import { escapeHtml, fill } from "./render";
import {
  backupCodesRegeneratedEmail,
  deleteAccountEmail,
  displayUrl,
  emailChangeEmail,
  emailSlots,
  formatDuration,
  invitationEmail,
  passkeyAddedEmail,
  passkeyRemovedEmail,
  passwordChangedEmail,
  passwordResetEmail,
  passwordSetEmail,
  signInConnectedEmail,
  signInDisconnectedEmail,
  stepUpCodeEmail,
  supportMessageEmail,
  testEmail,
  twoFactorDisabledEmail,
  twoFactorEnabledEmail,
  verificationEmail,
  type EmailContent,
  type EmailContext,
  type TemplateName,
} from "./templates";

const withSupport = { appUrl: "https://app.example", supportEmail: "help@app.example" };
const noSupport = { appUrl: "https://app.example" };
const token = "tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const url = `https://app.example/api/auth/verify?token=${token}`;
const resetUrl = "https://app.example/forgot-password";
const hour = 3600;

const hostile =
  'Acme</strong></a><script>alert(1)</script><h1 style="color:red">Locked</h1><a href="https://evil.example/login">Verify</a>\r\nBcc: x@evil.example {{url}}';

/** Each template with its slot inputs, so runtime output can be compared with a direct React render. */
const cases: Record<
  TemplateName,
  {
    make: (ctx: EmailContext) => EmailContent;
    input: Record<string, string>;
  }
> = {
  verification: {
    make: (ctx) => verificationEmail(ctx, { url, expiresInSeconds: hour }),
    input: { url, expiry: "1 hour" },
  },
  passwordReset: {
    make: (ctx) => passwordResetEmail(ctx, { url, expiresInSeconds: hour }),
    input: { url, expiry: "1 hour" },
  },
  invitation: {
    make: (ctx) =>
      invitationEmail(ctx, {
        organizationName: hostile,
        inviterEmail: 'b"<script>@example.com',
        url: "https://app.example/accept-invitation/abc",
        expiresInSeconds: 7 * 24 * hour,
      }),
    input: {
      organizationName: hostile,
      inviterEmail: 'b"<script>@example.com',
      url: "https://app.example/accept-invitation/abc",
      expiry: "7 days",
    },
  },
  supportMessage: {
    make: (ctx) =>
      supportMessageEmail(ctx, {
        from: 'x"><img src=x onerror=alert(1)>@example.com',
        topicLabel: "Question",
        message: `Line one\r\n\r\n${hostile}\u0007`,
      }),
    input: {
      from: 'x"><img src=x onerror=alert(1)>@example.com',
      topicLabel: "Question",
      message: `Line one\r\n\r\n${hostile}\u0007`,
    },
  },
  test: { make: (ctx) => testEmail(ctx), input: {} },
  deleteAccount: {
    make: (ctx) => deleteAccountEmail(ctx, { url, expiresInSeconds: hour, resetUrl }),
    input: { url, expiry: "1 hour", resetUrl },
  },
  passwordChanged: {
    make: (ctx) => passwordChangedEmail(ctx, { resetUrl }),
    input: { resetUrl },
  },
  stepUpCode: {
    make: (ctx) => stepUpCodeEmail(ctx, { code: "123456", expiresInSeconds: 600 }),
    input: { code: "123456", expiry: "10 minutes" },
  },
  twoFactorEnabled: {
    make: (ctx) => twoFactorEnabledEmail(ctx, { resetUrl }),
    input: { resetUrl },
  },
  twoFactorDisabled: {
    make: (ctx) => twoFactorDisabledEmail(ctx, { resetUrl, byAdmin: false }),
    input: { resetUrl },
  },
  twoFactorReset: {
    make: (ctx) => twoFactorDisabledEmail(ctx, { resetUrl, byAdmin: true }),
    input: { resetUrl },
  },
  backupCodesRegenerated: {
    make: (ctx) => backupCodesRegeneratedEmail(ctx, { resetUrl }),
    input: { resetUrl },
  },
  passkeyAdded: { make: (ctx) => passkeyAddedEmail(ctx, { resetUrl }), input: { resetUrl } },
  passkeyRemoved: { make: (ctx) => passkeyRemovedEmail(ctx, { resetUrl }), input: { resetUrl } },
  passwordSet: { make: (ctx) => passwordSetEmail(ctx, { resetUrl }), input: { resetUrl } },
  signInConnected: {
    make: (ctx) => signInConnectedEmail(ctx, { resetUrl, provider: "Google" }),
    input: { resetUrl, provider: "Google" },
  },
  signInDisconnected: {
    make: (ctx) => signInDisconnectedEmail(ctx, { resetUrl, provider: "GitHub" }),
    input: { resetUrl, provider: "GitHub" },
  },
  emailChange: {
    make: (ctx) =>
      emailChangeEmail(ctx, {
        currentEmail: "old@example.com",
        newEmail: hostile,
        url,
        resetUrl,
        expiresInSeconds: hour,
      }),
    input: { currentEmail: "old@example.com", newEmail: hostile, url, resetUrl, expiry: "1 hour" },
  },
};

const variants = [
  ["with a support inbox", withSupport],
  ["without a support inbox", noSupport],
] as const;

describe("generated templates", () => {
  it("are current with the React sources (else run `bun run email:generate`)", async () => {
    expect(await prerenderAll()).toEqual(TEMPLATES);
  });

  it("reject a text slot inside an attribute", () => {
    expect(() =>
      checkSlots("bad", ["newEmail"], { html: '<a href="{{newEmail}}">x</a>', text: "" }),
    ).toThrow(/inside an attribute/);
    expect(() =>
      checkSlots("bad", ["url"], { html: '<a href="https://x/?u={{url}}">x</a>', text: "" }),
    ).toThrow(/must start/);
  });
});

describe.each(Object.entries(cases))("%s email", (name, { make, input }) => {
  describe.each(variants)("%s", (_label, ctx) => {
    const mail = make(ctx);

    it("matches a direct React render of the source with the same values", async () => {
      const direct = await renderSource(name as TemplateName, emailSlots(ctx, input));
      // React writes ' as &#x27; and escapeHtml as &#39;: the same character.
      const same = (html: string) => html.replaceAll("&#x27;", "&#39;");
      expect(same(mail.html)).toBe(same(direct.html));
      expect(mail.text).toBe(direct.text);
    });

    it("has the layout's structure, dark-mode support and a hidden preheader", () => {
      const { html } = mail;
      expect(html).toContain('<html dir="ltr" lang="en">');
      expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
      expect(html).toContain('<meta name="supported-color-schemes" content="light dark"/>');
      expect(html).toContain("@media (prefers-color-scheme:dark)");
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      const tables = html.match(/<table[^>]*>/g) ?? [];
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) expect(table).toContain('role="presentation"');
      expect(html).toMatch(/<body[^>]*>(<!--[^>]*-->)*<div style="display:none;[^"]*"[^>]*>\S/);
      // No placeholder is left unfilled (the hostile inputs carry a literal "{{url}}" on purpose).
      expect(html.replaceAll("{{url}}", "")).not.toMatch(/\{\{\w+\}\}/);
    });

    it("never lets user text break out of its element", () => {
      const { html } = mail;
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain('href="https://evil.example');
      expect(html).not.toContain('<h1 style="color:red">');
      // The text that looked like a slot stays literal text.
      if (JSON.stringify(input).includes("{{url}}")) expect(mail.text).toContain("{{url}}");
    });

    it("links only to absolute URLs and loads only the hosted PNG logo", () => {
      const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).toMatch(/^(https:\/\/app\.example\/|mailto:help@)/);
      const images = mail.html.match(/<img[^>]*>/g) ?? [];
      expect(images).toHaveLength(1);
      expect(images[0]).toContain('src="https://app.example/brand/email-logo.png"');
      expect(images[0]).toMatch(/width="32"/);
      expect(images[0]).toMatch(/height="32"/);
      expect(images[0]).toMatch(/alt=""/);
    });

    it("has a plain-text part with the footer, no markup and no stray control characters", () => {
      const { text, subject } = mail;
      expect(subject).toContain("ReceiptOCR");
      expect(subject).not.toMatch(/[\r\n]/);
      expect(text).toMatch(/^ReceiptOCR\n/);
      expect(text).toContain("Privacy: https://app.example/privacy");
      // Plain text carries user text as typed; the template itself adds no markup.
      const variant = ctx === withSupport ? "support" : "nosupport";
      expect(TEMPLATES[name as TemplateName][variant].text).not.toMatch(/<[a-z]/i);
      expect(text).not.toMatch(/[\r\u0000-\u0009\u000b-\u001f]/);
      // Only the contact-form message keeps the visitor's line breaks.
      if (name !== "supportMessage") expect(text).not.toMatch(/\nBcc:/);
    });

    it("shows the support inbox only when there is one", () => {
      // The contact-form message goes to support itself; its footer points at the visitor.
      if (name === "supportMessage") return;
      if (ctx === withSupport) expect(mail.html).toContain('href="mailto:help@app.example"');
      else {
        expect(mail.html).not.toContain("mailto:");
        expect(mail.text).not.toContain("Reply to this email or write to");
      }
    });
  });
});

describe("link emails", () => {
  it("show the token only in hrefs and the plain text, never as visible text", () => {
    const { html, text } = verificationEmail(withSupport, { url, expiresInSeconds: hour });
    expect(text).toContain(url);
    expect(html).toContain(`href="${escapeHtml(url)}"`);
    expect(html.split(token)).toHaveLength(3); // button and fallback link hrefs
    expect(html).not.toMatch(new RegExp(`>[^<]*${token}`));
    expect(html).toContain(">app.example/api/auth/verify<");
  });

  it("put the action link first in the plain text", () => {
    for (const mail of [
      verificationEmail(withSupport, { url, expiresInSeconds: hour }),
      emailChangeEmail(withSupport, {
        currentEmail: "o@example.com",
        newEmail: "n@example.com",
        url,
        resetUrl,
        expiresInSeconds: hour,
      }),
      deleteAccountEmail(withSupport, { url, expiresInSeconds: hour, resetUrl }),
    ]) {
      expect(mail.text.match(/https?:\/\/\S+/)?.[0]).toBe(url);
    }
  });

  it("quote the configured lifetime", () => {
    expect(passwordResetEmail(withSupport, { url, expiresInSeconds: hour }).text).toContain(
      "expires in 1 hour",
    );
    expect(cases.invitation.make(withSupport).html).toContain("expires in 7 days");
  });

  it("refuse links off the app's origin, including lookalike hosts and ports", () => {
    for (const foreign of [
      "https://evil.example/login",
      "https://app.example.evil.example/x",
      "http://app.example/x",
      "https://app.example:8443/x",
    ]) {
      expect(() =>
        verificationEmail(withSupport, { url: foreign, expiresInSeconds: hour }),
      ).toThrow(/must be on https:\/\/app\.example/);
      expect(() => passwordChangedEmail(withSupport, { resetUrl: foreign })).toThrow();
    }
    expect(
      verificationEmail(withSupport, { url: "https://app.example/ok?x=1", expiresInSeconds: hour })
        .text,
    ).toContain("https://app.example/ok?x=1");
  });

  it("refuse non-http links and origins", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "/relative", "mailto:a@b.c"]) {
      expect(() => verificationEmail(withSupport, { url: bad, expiresInSeconds: hour })).toThrow();
      expect(() => passwordChangedEmail(withSupport, { resetUrl: bad })).toThrow();
      expect(() => testEmail({ appUrl: bad })).toThrow();
    }
  });

  it("refuse a support address that could break out of mailto:", () => {
    for (const supportEmail of ['a"@b.c', "a@b.c?bcc=x@y.z", "not an address"]) {
      expect(() => testEmail({ appUrl: "https://app.example", supportEmail })).toThrow();
    }
  });
});

describe("invitationEmail", () => {
  const mail = cases.invitation.make(withSupport);

  it("escapes the workspace name and inviter", () => {
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mail.html).toContain("b&quot;&lt;script&gt;@example.com");
    expect(mail.html.match(/<h1/g)).toHaveLength(1);
  });

  it("uses a fixed subject and preheader with no user text", () => {
    expect(mail.subject).toBe("You're invited to a ReceiptOCR workspace");
    expect(mail.html).toContain(">Accept the invitation to share receipts in this workspace.<");
  });

  it("keeps user text to one line in the plain-text part", () => {
    const { text } = invitationEmail(withSupport, {
      organizationName: "Acme\r\n\r\nYour account is locked\u0007",
      inviterEmail: "b@example.com",
      url: "https://app.example/x",
      expiresInSeconds: 604800,
    });
    expect(text).toContain('"Acme Your account is locked"');
  });

  it("wraps a very long workspace name instead of overflowing", () => {
    const long = "W".repeat(2000);
    const { html } = invitationEmail(withSupport, {
      organizationName: long,
      inviterEmail: "b@example.com",
      url: "https://app.example/x",
      expiresInSeconds: 604800,
    });
    expect(html).toMatch(new RegExp(`<strong[^>]*overflow-wrap:break-word[^>]*>${long}<`));
  });
});

describe("supportMessageEmail", () => {
  it("keeps the visitor's line breaks but no other control characters", () => {
    const { text, html, subject } = cases.supportMessage.make(withSupport);
    expect(subject).toBe("[ReceiptOCR support] Question");
    expect(text).toContain("Line one\n\nAcme");
    expect(html).toContain("Line one\n\nAcme");
    expect(text).not.toContain("\u0007");
  });
});

describe("security notices", () => {
  it("delete confirmation: red button, single-use link, nothing changes until confirmed on the page", () => {
    const delUrl = "https://app.example/app/settings/delete-account?token=abc";
    const mail = deleteAccountEmail(withSupport, {
      url: delUrl,
      expiresInSeconds: hour,
      resetUrl,
    });
    expect(mail.subject).toBe("Confirm deleting your ReceiptOCR account");
    expect(mail.html).toContain(`href="${delUrl}"`);
    expect(mail.html).toMatch(
      /background-color:rgb\(185,28,28\)[^>]*>[\s\S]*?Continue to delete account/,
    );
    expect(mail.text).toContain(delUrl);
    expect(mail.text).toMatch(/works once and expires in 1 hour/);
    expect(mail.text).toContain("confirm on the page it opens. Until then, nothing is deleted.");
    expect(mail.text).toContain("Receipts you uploaded to shared workspaces stay there.");
    expect(mail.text).toContain(`reset your password (${resetUrl})`);
    expect(mail.html).toContain(`href="${resetUrl}"`);
  });

  it("password changed: points at the reset page and the support inbox", () => {
    const mail = passwordChangedEmail(withSupport, { resetUrl });
    expect(mail.subject).toBe("Your ReceiptOCR password was changed");
    expect(mail.html).toContain(`href="${resetUrl}"`);
    expect(mail.html).toContain('href="mailto:help@app.example"');
    expect(mail.text).toContain("contact us at help@app.example");
    expect(mail.text).toContain(resetUrl);
  });

  it("password changed: falls back to the in-app support form without a support inbox", () => {
    const mail = passwordChangedEmail(noSupport, { resetUrl });
    expect(mail.html).not.toContain("mailto:");
    expect(mail.text).toContain("support button in the app");
  });

  it("email change: approval link is the button, reset link is in the note, address escaped", () => {
    const mail = emailChangeEmail(withSupport, {
      currentEmail: "old@example.com",
      newEmail: '"><h1>locked</h1>@evil.example\r\nBcc: x',
      url,
      resetUrl,
      expiresInSeconds: hour,
    });
    expect(mail.subject).toBe("Approve your ReceiptOCR email change");
    expect(mail.html).not.toContain("<h1>locked");
    expect(mail.html.match(/<h1/g)).toHaveLength(1);
    const button = mail.html.match(/<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?Approve email change/)?.[1];
    expect(button).toBe(escapeHtml(url));
    expect(mail.html).toContain(`href="${resetUrl}"`);
    expect(mail.text).toContain("from old@example.com to ");
    expect(mail.text).toContain("expires in 1 hour");
    expect(mail.text).toContain(resetUrl);
    expect(mail.text).not.toMatch(/\r|\n\s*Bcc/);
  });

  it("verification to the new address never names the old one", () => {
    const mail = verificationEmail(withSupport, { url, expiresInSeconds: hour });
    expect(mail.text + mail.html).not.toContain("old@example.com");
  });
});

describe("security emails", () => {
  it("puts the step-up code in the body only, escaped", () => {
    const mail = stepUpCodeEmail(withSupport, { code: "123456", expiresInSeconds: 600 });
    expect(mail.subject).not.toContain("123456");
    expect(mail.text).toContain("123456");
    expect(mail.html).toContain("123456");
    expect(mail.text).toContain("10 minutes");
    expect(stepUpCodeEmail(withSupport, { code: "<b>", expiresInSeconds: 600 }).html).toContain(
      "&lt;b&gt;",
    );
  });

  it("tells the user how to react to a factor change they didn't make", () => {
    for (const mail of [
      twoFactorEnabledEmail(withSupport, { resetUrl }),
      twoFactorDisabledEmail(withSupport, { resetUrl, byAdmin: false }),
      backupCodesRegeneratedEmail(withSupport, { resetUrl }),
      passkeyAddedEmail(withSupport, { resetUrl }),
      passkeyRemovedEmail(withSupport, { resetUrl }),
      passwordSetEmail(withSupport, { resetUrl }),
      signInConnectedEmail(withSupport, { resetUrl, provider: "Google" }),
      signInDisconnectedEmail(withSupport, { resetUrl, provider: "GitHub" }),
    ]) {
      expect(mail.text).toContain("Didn't do this? Reset your password now");
      expect(mail.html).toContain(`href="${resetUrl}"`);
    }
  });

  it("names the provider that was connected or disconnected", () => {
    const connected = signInConnectedEmail(withSupport, { resetUrl, provider: "Google" });
    expect(connected.subject).toBe("Google sign-in was connected to your ReceiptOCR account");
    expect(connected.text).toContain("Google was connected to your account.");
    const disconnected = signInDisconnectedEmail(withSupport, { resetUrl, provider: "GitHub" });
    expect(disconnected.html).toContain("GitHub sign-in was disconnected");
  });

  it("says when an administrator made the reset", () => {
    const reset = twoFactorDisabledEmail(withSupport, { resetUrl, byAdmin: true });
    expect(reset.subject).toContain("was reset");
    expect(reset.text).toContain("signed out everywhere");
    expect(twoFactorDisabledEmail(withSupport, { resetUrl, byAdmin: false }).subject).toContain(
      "is off",
    );
  });
});

describe("helpers", () => {
  it("escapeHtml escapes markup and both quote styles", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });

  it("fill expands each placeholder once and refuses a missing value", () => {
    expect(fill("<p>{{a}}</p>", { a: "{{b}}", b: "x" }, "html")).toBe("<p>{{b}}</p>");
    expect(() => fill("{{a}}", {}, "text")).toThrow(/Missing/);
  });

  it("attribute-escapes CTA URLs", () => {
    const { html } = passwordResetEmail(withSupport, {
      url: 'https://app.example/r?a=1&b="2"',
      expiresInSeconds: hour,
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
