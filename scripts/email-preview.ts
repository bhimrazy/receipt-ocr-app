#!/usr/bin/env bun
// Renders every transactional email with sample data to HTML and plain-text files for review.
//
//   bun run email:preview [--out <dir>] [--app-url https://receipt-ocr.bhimraj.com.np]
//
// Open the .html files in a browser; toggle the OS or devtools colour scheme to see dark mode.
// Sample links carry fake tokens; nothing is sent.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  deleteAccountEmail,
  emailChangeEmail,
  invitationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  supportMessageEmail,
  testEmail,
  verificationEmail,
  type EmailContent,
} from "../packages/email/src/index";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const out = flag("out", ".email-preview");
const appUrl = flag("app-url", "https://receipt-ocr.bhimraj.com.np");
const ctx = { appUrl, supportEmail: "receipt-ocr@bhimraj.com.np" };
const token =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsImlhdCI6MTc2MjQ4MDAwMH0.c2FtcGxlLXNpZ25hdHVyZS1ub3QtcmVhbA";
const hour = 3600;

const emails: Record<string, EmailContent> = {
  verification: verificationEmail(ctx, {
    url: `${appUrl}/api/auth/verify-email?token=${token}&callbackURL=%2Fapp`,
    expiresInSeconds: hour,
  }),
  "password-reset": passwordResetEmail(ctx, {
    url: `${appUrl}/api/auth/reset-password/${token}?callbackURL=%2Freset-password`,
    expiresInSeconds: hour,
  }),
  invitation: invitationEmail(ctx, {
    organizationName: "Lovelace & Babbage Bookkeeping",
    inviterEmail: "ada.lovelace@example.com",
    url: `${appUrl}/accept-invitation/inv_8f3a2c9d1e7b4a6f`,
    expiresInSeconds: 7 * 24 * hour,
  }),
  "support-message": supportMessageEmail(ctx, {
    from: "visitor@example.com",
    topicLabel: "Feature request",
    message:
      "Could you add CSV export grouped by month?\n\nThanks, it saves me an hour every quarter.",
  }),
  "test-email": testEmail(ctx),
  "delete-account": deleteAccountEmail(ctx, {
    url: `${appUrl}/app/settings/delete-account?token=${token}`,
    expiresInSeconds: hour,
  }),
  "password-changed": passwordChangedEmail(ctx, { resetUrl: `${appUrl}/forgot-password` }),
  "email-change": emailChangeEmail(ctx, {
    newEmail: "ada.new@example.com",
    url: `${appUrl}/api/auth/verify-email?token=${token}&callbackURL=%2Fapp%2Fsettings`,
    resetUrl: `${appUrl}/forgot-password`,
    expiresInSeconds: hour,
  }),
  "password-changed-no-support": passwordChangedEmail(
    { appUrl },
    { resetUrl: `${appUrl}/forgot-password` },
  ),
};

mkdirSync(out, { recursive: true });
for (const [name, mail] of Object.entries(emails)) {
  writeFileSync(path.join(out, `${name}.html`), mail.html);
  writeFileSync(path.join(out, `${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`);
}
console.log(`email-preview: ${Object.keys(emails).length} emails in ${path.resolve(out)}`);
