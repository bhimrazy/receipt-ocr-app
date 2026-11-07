# packages/email

Sends transactional mail through [Resend](https://resend.com) and builds the messages with
[React Email](https://react.email). It never throws on delivery: the caller decides whether an undelivered message is
an error.

## Public API

| Export (from [`src/index.ts`](../../packages/email/src/index.ts) and [`src/templates.tsx`](../../packages/email/src/templates.tsx)) | Does                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `sendEmail(config, { to, subject, html, text, replyTo? })` (`config.replyTo`, set from `SUPPORT_EMAIL`, is the default Reply-To)    | Returns `{ delivered: true, id }` or `{ delivered: false, reason: "not_configured" or "failed" }` |
| `verificationEmail(ctx, { url, expiresInSeconds })`                                                                                 | `Promise<{ subject, html, text }>` for "confirm your email"                                       |
| `passwordResetEmail(ctx, { url, expiresInSeconds })`                                                                                | Same for a reset link                                                                             |
| `invitationEmail(ctx, { organizationName, inviterEmail, url, expiresInSeconds })`                                                   | Same for a workspace invitation                                                                   |
| `supportMessageEmail(ctx, { from, topicLabel, message })`                                                                           | A contact-form message for the support inbox                                                      |
| `testEmail(ctx)`                                                                                                                    | The admin console's delivery check                                                                |
| `deleteAccountEmail`, `passwordChangedEmail`, `emailChangeNoticeEmail`                                                              | Account-security messages, designed here and wired by the step-up verification work               |
| `escapeHtml(value)`                                                                                                                 | Escapes values for hand-built HTML (templates rely on React's escaping)                           |

`ctx` is an `EmailContext`: `{ appUrl, supportEmail? }`. The package reads no environment; the web app builds it once
as `emailContext` in [`lib/env.ts`](../../apps/web/lib/env.ts) from `BETTER_AUTH_URL` and `SUPPORT_EMAIL`. Links, the
logo (`<appUrl>/icons/icon-192.png`) and the privacy link all hang off `appUrl`, so a preview deployment's mail points
at the preview.

## Who sends what

| Message         | Sent from                                                                                                  | When undelivered in production |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Verification    | Better Auth `sendVerificationEmail` in [`lib/auth.ts`](../../apps/web/lib/auth.ts)                         | The auth request fails         |
| Password reset  | Better Auth `sendResetPassword`                                                                            | The auth request fails         |
| Invitation      | Organization plugin `sendInvitationEmail`                                                                  | The invite request fails       |
| Support message | [`api/contact/route.ts`](../../apps/web/app/api/contact/route.ts), to `SUPPORT_EMAIL`, reply-to the sender | The route returns `503`        |
| Test email      | Admin settings, [`lib/test-email.ts`](../../apps/web/lib/test-email.ts)                                    | The admin sees "failed"        |

In `lib/auth.ts`, `deliver()` throws when a message is not delivered and `NODE_ENV` is production, so a user is never
told "check your inbox" for mail that was not sent. The link lifetimes (verification and reset 1 hour, invitations 7
days) are constants there, passed both to Better Auth and to the templates, so the copy can't drift from the real
expiry.

## Message format

Every template renders through one `Layout` ([`src/layout.tsx`](../../packages/email/src/layout.tsx)), the shape
well-branded transactional mail converges on (Linear, Vercel, Stripe, Notion; React Email's
[templates](https://react.email/templates)):

1. **Header:** the app icon (hosted PNG, 32×32) and the `receiptOCR` wordmark as live text.
2. **One heading** (`h1`) that says what the mail is about.
3. **A short body**, one or two sentences.
4. **At most one primary action**, then its expiry and a "Button not working? Open this link:" fallback whose visible
   text is the host (and short path), never the token. The full URL is in the `href` and the plain-text part.
5. **A security note** ("Didn't sign up? You can ignore this email."). Security notices put a "Wasn't you?" note with
   the support address above a "Reset your password" action.
6. **Footer:** why you got this, where replies go (Reply-To is the support inbox), app name, site and privacy links.

Each message also has a hidden preheader (inbox preview text) and a hand-written plain-text part in the same order.
Invitation subjects and preheaders are fixed text: workspace names and addresses are user input, and the inbox list
is where a phishing lure would be read first.

### Light-first, dark-safe

- The design is light (zinc neutrals, emerald `#047857` button with white text at 5.5:1). Clients that apply their own
  dark mode (Gmail apps, Outlook) invert light designs predictably; a dark design gets inverted into a light one
  ([Litmus dark-mode guide](https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers)).
- `<meta name="color-scheme" content="light dark">`, `supported-color-schemes` and `dark:` Tailwind variants (compiled
  to `@media (prefers-color-scheme: dark)` rules with `!important`) give Apple Mail, iOS Mail and other supporting
  clients a designed dark theme from the app's own tokens (`#0a0a0b` canvas, `#141416` card, `#34d399` accent).
  Support for the media query is partial
  ([caniemail](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/)), which is why the light design
  must stand on its own.
- The logo is the app icon PNG (emerald tile, dark glyph), legible on both backgrounds without a swap. No SVG: Gmail
  rasterizes or drops it ([caniemail](https://www.caniemail.com/features/image-svg/)). It is decorative (`alt=""`)
  because the wordmark beside it is text, so image-blocking clients still show the name.
- The canvas colour sits on a full-width table, not `<body>`, because Gmail strips body styles.

Colours live in [`src/theme.ts`](../../packages/email/src/theme.ts), mapped from `packages/ui/src/styles.css`.

## Design principles and invariants

- **Optional by configuration.** Without `RESEND_API_KEY` and `EMAIL_FROM`, `sendEmail` logs
  `email.not_configured` and returns `delivered: false`. In development (`logUndelivered`) it also logs the recipient
  and text, so reset and invite links stay usable locally. Elsewhere it logs the event only, because those links are
  credentials.
- **Logs carry no address, subject or body.**
- **Interpolated values are escaped.** React escapes every value in the HTML; plain-text parts collapse user text to
  one line. Workspace names are also restricted to plain text by
  [`parseWorkspaceName`](../../packages/core/src/workspace-name.ts).
- **Only absolute http(s) links.** `absoluteUrl()` rejects anything else before it reaches a message.
- **No tracking pixels or remote fonts.** The only remote resource is the logo.

## Dependencies

`react-email` (components and the `Tailwind` inliner) and `@react-email/render`, both from the Resend team
([resend/react-email](https://github.com/resend/react-email)). React Email 6 folded the `@react-email/*` component
packages, now deprecated on npm, into `react-email`. That package also carries its preview CLI's dependencies
(esbuild, socket.io, babel and others); only `@react-email/render`, `tailwindcss`, `css-tree`, `marked` and `prismjs`
load at runtime. React and Tailwind are the versions the web app pins.

Rendering runs in Next's RSC layer (route handlers, server actions). The first render in a process compiles Tailwind
(about 0.4 s); later ones take tens of milliseconds.

## How to test it

- [`templates.test.ts`](../../packages/email/src/templates.test.ts) checks every template's structure (`lang`,
  presentational tables, one `h1`, colour-scheme meta, dark media rules, hidden preheader), absolute links, the single
  logo image, plain text, expiry copy and escaping. [`index.test.ts`](../../packages/email/src/index.test.ts) covers
  sending and logging. Both run with `bun run test`.
- `bun run email:preview [--out dir]` writes every template as `.html` and `.txt` with sample data (to
  `.email-preview/`, git-ignored). Open the HTML and switch the colour scheme to check dark mode.
- For real delivery, Resend's test recipients (`delivered@resend.dev` and others, listed in
  [`.env.example`](../../.env.example)) accept mail without sending it.

## Common changes

- **Add a message.** Add an async template to [`templates.tsx`](../../packages/email/src/templates.tsx) that renders
  `Layout` (one heading, one `Action` at most, a `Note`, a footer `reason`) and a matching `plainText()`, add it to
  the preview script and the `all` table in the tests, then call `sendEmail` from the web app.
