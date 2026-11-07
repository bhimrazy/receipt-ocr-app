# packages/email

Sends transactional mail through [Resend](https://resend.com) and builds the messages. It never throws: the caller
decides whether an undelivered message is an error.

## Public API

| Export (from [`src/index.ts`](../../packages/email/src/index.ts) and [`src/templates.ts`](../../packages/email/src/templates.ts)) | Does                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `sendEmail(config, { to, subject, html, text, replyTo? })` (`config.replyTo`, set from `SUPPORT_EMAIL`, is the default Reply-To)  | Returns `{ delivered: true, id }` or `{ delivered: false, reason: "not_configured" or "failed" }` |
| `verificationEmail(url)`                                                                                                          | Subject, HTML and text for "confirm your email"                                                   |
| `passwordResetEmail(url)`                                                                                                         | Same for a reset link                                                                             |
| `invitationEmail({ organizationName, inviterEmail, url })`                                                                        | Same for a workspace invitation                                                                   |
| `escapeHtml(value)`                                                                                                               | Escapes values interpolated into HTML (workspace names, emails)                                   |

The contact form builds its own message in [`apps/web/lib/contact-mail.ts`](../../apps/web/lib/contact-mail.ts).

## Who sends what

| Message         | Sent from                                                                                                  | When undelivered in production |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Verification    | Better Auth `sendVerificationEmail` in [`lib/auth.ts`](../../apps/web/lib/auth.ts)                         | The auth request fails         |
| Password reset  | Better Auth `sendResetPassword`                                                                            | The auth request fails         |
| Invitation      | Organization plugin `sendInvitationEmail`                                                                  | The invite request fails       |
| Support message | [`api/contact/route.ts`](../../apps/web/app/api/contact/route.ts), to `SUPPORT_EMAIL`, reply-to the sender | The route returns `503`        |

In `lib/auth.ts`, `deliver()` throws when a message is not delivered and `NODE_ENV` is production, so a user is never
told "check your inbox" for mail that was not sent.

## Design principles and invariants

- **Optional by configuration.** Without `RESEND_API_KEY` and `EMAIL_FROM`, `sendEmail` logs
  `email.not_configured` and returns `delivered: false`. In development (`logUndelivered`) it also logs the recipient
  and text, so reset and invite links stay usable locally. Elsewhere it logs the subject only, because those links
  are credentials.
- **Logs carry the recipient's domain, not the address.**
- **Interpolated values are escaped.** Templates escape every value; workspace names are also restricted to plain
  text by [`parseWorkspaceName`](../../packages/core/src/workspace-name.ts).

## How to test it

[`index.test.ts`](../../packages/email/src/index.test.ts) and
[`templates.test.ts`](../../packages/email/src/templates.test.ts) run with `bun run test`. For real delivery, Resend's
test recipients (`delivered@resend.dev` and others, listed in [`.env.example`](../../.env.example)) accept mail
without sending it.

## Common changes

- **Add a message.** Add a template function returning `EmailContent` to
  [`templates.ts`](../../packages/email/src/templates.ts), escape every interpolated value, add a test, and call
  `sendEmail` from the web app.
