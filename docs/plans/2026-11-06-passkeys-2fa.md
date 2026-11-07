# Passkeys and two-factor authentication — plan (2026-11-06)

Status: proposal. Nothing implemented yet. Every behaviour claim below was checked against the installed
`better-auth@1.7.14` source (`node_modules/.bun/better-auth@1.7.14+…/dist/plugins/two-factor/**`) and the packed
`@better-auth/passkey@1.7.14` tarball, not recalled from docs.

## TL;DR

- **2FA:** built-in `twoFactor` plugin (`better-auth/plugins/two-factor`, already installed). TOTP and backup codes.
  **No email OTP.**
- **Passkeys:** new direct dependency `@better-auth/passkey@1.7.14`, exact pin, the same version as `better-auth`.
  Use passkeys both as a primary sign-in (button plus autofill) and as the admin factor.
- **Policy:** optional for customers, with gentle nudges. Required for platform admins, enforced at `requireAdmin()`
  and checked on how the session was created, not just on whether a factor is enrolled. Admins can reset a user's 2FA
  or remove their passkeys with a reason and an audit row. They never see secrets.
- **Two PRs:** (A) TOTP + backup codes + Security page + admin reset. (B) Passkeys + admin enforcement.

## 1. What the installed code actually does (findings that shape the design)

### twoFactor plugin (better-auth 1.7.14)

| Topic                 | Behaviour in source                                                                                                                                                                                                                      | Consequence for us                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where 2FA is enforced | Only in an `after` hook on `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`. It deletes the new session, sets a signed `two_factor` cookie (10 min) and returns `{ twoFactorRedirect: true, twoFactorMethods }`            | **Google/GitHub OAuth sign-in skips 2FA** (`/callback/*`), and so do passkey sign-in, email-verification auto sign-in and admin impersonation. 2FA protects password sign-ins only |
| Who can enable        | Password required unless `allowPasswordless`                                                                                                                                                                                             | Keep the default. Hide TOTP for OAuth-only users (it would never be challenged) and point them to passkeys                                                                         |
| Enrolment             | `enable` stores an encrypted secret with `verified:false` and returns `totpURI` + backup codes. `twoFactorEnabled` turns on only after the first successful `verify-totp`, and the session is rotated then                               | No half-enabled accounts. The UI must finish verification                                                                                                                          |
| TOTP secret storage   | `symmetricEncrypt` (XChaCha20-Poly1305) with the versioned `secretConfig`, envelope `$ba$<version>$…`                                                                                                                                    | Works with `BETTER_AUTH_SECRETS`. **Never retire a secret version while TOTP rows sealed with it exist.** The secret is never re-sealed. Add this to `docs/deployment.md`          |
| Backup codes          | 10 codes, `xxxxx-xxxxx`, **encrypted, not hashed** (`storeBackupCodes: "encrypted"` default; `"plain"` or custom are the only alternatives). Single use, consumed with a compare-and-swap. Re-sealed with the current secret on each use | Acceptable: hashing isn't offered, and the DB alone can't read them. Keep the default                                                                                              |
| Verify limits         | Plugin rate limit of 3 requests per 10 s per IP on `/two-factor/*`, 5 attempts per challenge cookie, then **account lockout after 10 consecutive failures for 15 min** (`accountLockout`, on by default)                                 | Enough. Keep the defaults and add nothing                                                                                                                                          |
| TOTP window           | ±1 period (about 90 s). **No replay protection**: a used code stays valid inside the window                                                                                                                                              | Known limitation. Mitigated because the code also needs the `two_factor` cookie from the password step                                                                             |
| Trusted devices       | `trustDevice: true` gives a signed `trust_device` cookie and a `verification` row (`trust-device-…`, value = userId), 30 days, rotated on each use                                                                                       | `disable` revokes **only the current device's** trust record. Our disable/reset code must also delete the user's other trust rows (see §3)                                         |
| Cookie cache          | Enable, verify and disable rotate the session and re-set the cookie cache                                                                                                                                                                | `getSession()` already skips the cache server-side, so no change is needed                                                                                                         |
| Email OTP             | If `otpOptions.sendOTP` is set, `otp` is offered to **every** 2FA user at sign-in                                                                                                                                                        | Don't enable it: email would then be both the password-reset channel and the second factor, so an inbox compromise beats both                                                      |
| Email verification    | `/verify-email` auto sign-in runs only for not-yet-verified users. In production you can't hold a session (and so can't enrol) before verifying                                                                                          | No bypass in production                                                                                                                                                            |
| Password reset        | `/reset-password` creates no session                                                                                                                                                                                                     | A reset still needs the second factor afterwards                                                                                                                                   |
| Impersonation         | `admin/impersonate-user` calls `createSession` directly, so there's no 2FA                                                                                                                                                               | Expected. Block factor changes while impersonating (see below)                                                                                                                     |

### @better-auth/passkey 1.7.14

| Topic             | Behaviour in source                                                                                                                                                                                                          | Consequence                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package           | Separate package `@better-auth/passkey` (repo `better-auth/better-auth`, `packages/passkey`). `better-auth/plugins/passkey` doesn't exist in 1.7.14                                                                          | Add it as a direct dependency                                                                                                                                                                              |
| rpID / origin     | `rpID` defaults to the hostname of `baseURL`. **`origin` defaults to the request's `Origin` header** when unset; it accepts `string \| string[]`                                                                             | Set both explicitly from `BETTER_AUTH_URL`                                                                                                                                                                 |
| User verification | Registration uses `residentKey: "preferred"`, `userVerification: "preferred"` (overridable through `authenticatorSelection`). Authentication hard-codes `userVerification: "preferred"` and `requireUserVerification: false` | Passkey sign-in can succeed with presence only. Set `authenticatorSelection.userVerification: "required"` and reject `!verification.authenticationInfo.userVerified` in `authentication.afterVerification` |
| Session creation  | `verify-authentication` calls `createSession` directly, so the 2FA hook doesn't run (correct: a passkey with UV counts as multi-factor)                                                                                      | The ban check (admin plugin session hook) still applies                                                                                                                                                    |
| Registration      | `freshSessionMiddleware` (session younger than `freshAge`, default **24 h**)                                                                                                                                                 | A stolen cookie younger than 24 h can add an attacker's passkey. Mitigations: block during impersonation, send a notification email, and consider a lower `freshAge` (owner decision)                      |
| Delete / rename   | `sessionMiddleware` plus an ownership check; no password or freshness required                                                                                                                                               | Fine for a list UI. Send a notification email                                                                                                                                                              |
| Rate limits       | None of its own; `/passkey/*` isn't under `/sign-in`, so the global default of 100 per 10 s applies                                                                                                                          | Add custom rules                                                                                                                                                                                           |
| Counter           | Stored as `number`                                                                                                                                                                                                           | WebAuthn counters are uint32, so use `bigint({ mode: "number" })`                                                                                                                                          |
| Labels            | Exports `getAuthenticatorName(aaguid)` (best effort; Apple sends an all-zero AAGUID)                                                                                                                                         | Default name = `getAuthenticatorName(aaguid) ?? "Passkey"`, which the user can rename                                                                                                                      |

## 2. Packages (exact pins; bunfig `minimumReleaseAge = "7d"`)

Today is 2026-11-06, so releases from 2026-10-30 or earlier qualify.

| Package                     | Pin                           | Published  | Age  | Where                                   | Notes                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------- | ---------- | ---- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@better-auth/passkey`      | **1.7.14**                    | 2026-10-26 | 11 d | `apps/web` dependencies                 | Peers satisfied by the tree: `better-auth ^1.7.14`, `@better-auth/core ^1.7.14`, `better-call 1.4.4` (exact, installed), `@better-fetch/fetch 1.3.3` (installed), `nanostores ^1.0.1` (1.4.0 installed). Integrity `sha512-ZUODCRp9…yvepeg==`, 77 kB. **No install scripts** (only dev, build, test) |
| ↳ `@simplewebauthn/server`  | transitive `^13.3.2` → 13.3.3 | 2026-08-26 | —    | lockfile                                | No install scripts. Deps: `@peculiar/*` ASN.1/x509, `@hexagon/base64`, `@levischuck/tiny-cbor`. 14.x exists but isn't in range                                                                                                                                                                       |
| ↳ `@simplewebauthn/browser` | transitive `^13.3.0` → 13.3.0 | 2026-03-10 | —    | lockfile                                | No dependencies, no scripts                                                                                                                                                                                                                                                                          |
| `uqr`                       | **0.1.3**                     | 2026-04-03 | 7 mo | `apps/web` dependencies                 | QR code as an SVG string, no dependencies (unjs; maintainers pi0, antfu). Rendered on the client from `totpURI`; no network                                                                                                                                                                          |
| `@better-auth/utils`        | **0.5.1**                     | 2026-10-24 | 13 d | `apps/web` devDependencies (tests only) | Already in the tree (better-auth's own OTP and base32). Its `createOTP` and `base32` generate TOTP codes in integration and e2e tests, so no new package                                                                                                                                             |

- Don't upgrade `better-auth` as part of this work. 1.7.15–1.7.18 (Nov 1–5) are still inside the cooldown. If we
  later move to 1.7.15 or newer, move `@better-auth/passkey` in the same commit; versions must match.
- Don't add `@simplewebauthn/*` as direct dependencies: the plugin's client re-exports what we need, and `bun.lock`
  pins the transitive versions.
- Install with `bun add --exact`, commit `bun.lock`, and run `bun run check:deps && bun run knip && bun run audit`.
- Alternatives considered: `react-qr-code@2.2.0` (adds `prop-types` and `qrcode-generator`) and `qrcode@1.5.4`
  (pulls in `yargs` and `pngjs`). `otpauth@9.5.2` would also work for tests, but it's a new package.

## 3. Server configuration (apps/web/lib/auth.ts)

```ts
twoFactor({
  issuer: "receiptOCR",
  // defaults kept: TOTP 6 digits / 30 s, 10 encrypted backup codes,
  // 10-min challenge cookie, 30-day trusted device, lockout 10 fails / 15 min.
}),
passkey({
  rpID: new URL(authEnv.betterAuthUrl).hostname,   // or PASSKEY_RP_ID, see decisions
  rpName: "receiptOCR",
  origin: authEnv.betterAuthUrl,
  authenticatorSelection: { residentKey: "required", userVerification: "required" },
  authentication: {
    afterVerification: ({ verification }) => {
      if (!verification.authenticationInfo.userVerified) throw new APIError("UNAUTHORIZED", …);
    },
  },
}),
```

- **Rate limits** (`customRules`, overriding the plugin rules):
  `"/passkey/generate-authenticate-options": { window: 60, max: 20 }`,
  `"/passkey/verify-authentication": { window: 60, max: 10 }`,
  `"/passkey/generate-register-options": { window: 60, max: 10 }`. Keep the twoFactor plugin's default
  (3 per 10 s on `/two-factor/*`).
- **How the session was created**: add a session field `authMethod` (`session.additionalFields`, `input: false`). Set
  it in the existing `databaseHooks.session.create.before` from `ctx.path` (the hook receives the endpoint context):
  - `/two-factor/verify-totp` or `/two-factor/verify-backup-code` with no prior session: `"mfa"`
  - `/passkey/verify-authentication`: `"passkey"`
  - `/admin/impersonate-user`: `"impersonation"`
  - anything else: `"password"` or `"oauth"`
  - a rotation (enable/disable rotates sessions): keep the value it had
  - Keep this mapping as a pure, unit-tested function in `apps/web/lib/auth-method.ts`.
- **No factor changes while impersonating**: a global `hooks.before` matcher on `/two-factor/*` (except the verify
  paths at sign-in), `/passkey/generate-register-options`, `/passkey/verify-registration`, `/passkey/delete-passkey`,
  `/passkey/update-passkey`. It rejects when `session.session.impersonatedBy` is set. Otherwise an impersonating
  admin's fresh session could **register their own passkey on the customer's account**, a persistent backdoor.
- **Security emails** (new templates in `packages/email`): a global `hooks.after` keyed on path, sent only when the
  response succeeded, through `advanced.backgroundTasks` or a fire-and-log path. A failed notice must not fail the
  change. Covered events:
  - 2FA turned on (`verify-totp` that flips `twoFactorEnabled`)
  - 2FA turned off
  - backup codes regenerated
  - a backup code used to sign in
  - passkey added or removed
  - admin reset of 2FA or passkeys
- **Full trust revocation**: after `/two-factor/disable`, and in the admin reset, delete every `verification` row with
  `value = userId`. With `storeIdentifier: "hashed"` the `trust-device-…` identifiers can't be matched by prefix.
  Matching by value also clears pending 2FA challenges, which is what we want.

## 4. Schema and migration (packages/db/src/auth-schema.ts + drizzle)

Follow repo conventions: snake_case, timestamptz, explicit indexes, cascade deletes on user FKs.

| Change           | Columns                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user` +         | `two_factor_enabled boolean not null default false`                                                                                                                                                                                                                                                                                                       |
| `session` +      | `auth_method text` (nullable; old rows = unknown, which counts as not strong)                                                                                                                                                                                                                                                                             |
| new `two_factor` | `id text pk`, `secret text not null`, `backup_codes text not null`, `user_id text not null → user.id on delete cascade`, `verified boolean not null default true`, `failed_verification_count integer not null default 0`, `locked_until timestamptz`; **unique** index on `user_id`                                                                      |
| new `passkey`    | `id text pk`, `name text`, `public_key text not null`, `user_id text not null → user.id cascade`, `credential_id text not null`, `counter bigint(mode number) not null`, `device_type text not null`, `backed_up boolean not null`, `transports text`, `created_at timestamptz default now()`, `aaguid text`; index `user_id`, **unique** `credential_id` |

Migrations: Two migrations, each takes the next number after the `0000` baseline when its PR is written: `two_factor` (PR A: user column, session column, `two_factor`) and `passkey` (PR B).
Create them with `bun run db:generate`. They only add tables and nullable or defaulted columns, so there's no backfill
and they're safe to run before the deploy. Running them against production needs the owner's go (DB migration).

## 5. Policy

- **Customers: optional.** Nudges only:
  - a "Protect your account" card in Settings until a factor exists
  - a one-time, dismissible callout on `/app` after the third sign-in (remembered in localStorage)
  - a line in the password-reset success notice
  - no nagging modals
- **OAuth-only users**: Google/GitHub already handle their sign-in security. Offer passkeys. Hide TOTP with a short
  explanation, because it wouldn't be asked for at an OAuth sign-in.
- **Platform admins: required, enforced in `requireAdmin()`.** The rules:
  1. Not enrolled (no passkey, and no `twoFactorEnabled` with a password): redirect to
     `/app/settings/security?required=admin`.
  2. Enrolled, but `session.authMethod` isn't `passkey` or `mfa`: show a `/admin/verify` step-up page. It offers
     "Use your passkey" (`signIn.passkey()` creates a strong session in place) or "Sign out and sign in with password
     - code".
  3. Server actions in `app/admin/actions.ts` already go through `requireAdmin()`, so they inherit the check.
  - **Grace path**: `ADMIN_MFA_ENFORCE` (default on in production, off in dev and e2e unless set). Owners can switch
    it off for an emergency without a deploy rollback. Log a warning at startup when it's off in production.
  - Recovery when an admin loses every factor: another admin resets them (below). If they're the only admin,
    `UPDATE two_factor`/`passkey` by SQL per a `docs/deployment.md` runbook.
- **What admins can do** (admin user detail, both actions behind `ReasonDialog`, audited, both email the user):
  - **Reset two-factor**: one Effect service in `packages/core` (`resetSecondFactor(userId)`) that deletes the
    `two_factor` row, sets `two_factor_enabled = false`, deletes the user's verification rows (trust and challenges)
    and revokes every session.
  - **Remove passkeys**: deletes all of the user's `passkey` rows and revokes sessions.
  - Admins can't reset their own factors here; they use the Security page.
  - Admins never see secrets, backup codes or public keys. The detail page shows only "2FA on/off", the passkey count
    and the date each was added.
- **User recovery**:
  - lost authenticator: a backup code signs in, then turn 2FA off and on again, or regenerate codes
  - lost authenticator and codes: support request, identity check by email, admin reset
  - lost passkey: sign in with password (+TOTP) or OAuth, then remove the old passkey and add a new one
  - passkey-only users can always fall back to "Forgot password" or OAuth, because passkeys are additive and the
    password is never removed

## 6. UI

**Settings → Security** (`/app/settings/security`, a link card on `/app/settings` like Members; `packages/ui`
primitives on Base UI):

- _Authenticator app_: a status badge, then **Turn on**:
  1. Enter your password.
  2. A QR code (`uqr` SVG, `role="img"` with an `aria-label`) next to the manual key. The key is the base32 secret
     from `totpURI`, shown monospace in groups of 4, with a copy button. "Can't scan? Enter this key" is visible
     without extra clicks on mobile, where scanning your own screen is impossible.
  3. A code field: a single `<input inputMode="numeric" autoComplete="one-time-code" maxLength={6}>`, not split boxes.
  4. Backup codes, **shown once**, in a monospace grid with Copy and Download (`receiptocr-backup-codes.txt`). Closing
     requires an "I've saved these" checkbox.
  - Later: **Regenerate backup codes** (password, then show once) and **Turn off** (password, `ConfirmDialog`).
- _Passkeys_:
  - A list of name, "Synced" when `backedUp`, and date added, with Rename (dialog) and Remove (confirm) per row.
  - **Add a passkey**. Hidden when `window.PublicKeyCredential` is missing.
  - Error copy for `NotAllowedError`: "Cancelled or timed out".
- _Signed-in devices_: `listSessions`, with the current one marked, Revoke per row and "Sign out everywhere else"
  (`revokeOtherSessions`). Reuse the row layout from `admin/users/[id]/sessions-list.tsx`.

**Sign-in**:

- `CredentialsForm`: when `data.twoFactorRedirect` comes back, `router.push("/sign-in/two-factor" + redirectQuery)`.
  Register `twoFactorClient()` with no auto redirect so the form keeps control.
- New `/sign-in/two-factor`:
  - It redirects to `/sign-in` when the `two_factor` cookie is missing, and to `redirectTo` when already signed in.
  - Code input (autofocus, `FocusHeading`) with a "Trust this device for 30 days" checkbox, **unchecked by default**.
  - A "Use a backup code" toggle.
  - Mapped errors: `INVALID_CODE`, `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` and `INVALID_TWO_FACTOR_COOKIE` (both mean
    "start again" and go back to sign-in), and `ACCOUNT_TEMPORARILY_LOCKED`. All live in `lib/auth-errors.ts` and show
    in `role="alert"`.
- **Passkey**:
  - A "Sign in with a passkey" button above the social buttons.
  - The email field gets `autoComplete="username webauthn"`.
  - On mount, if `PublicKeyCredential.isConditionalMediationAvailable?.()`, call
    `authClient.signIn.passkey({ autoFill: true })`. SimpleWebAuthn aborts the pending conditional request when the
    button starts a modal one.
  - Silent on `AbortError`.

**Accessibility and mobile**: every input labelled; errors tied in with `aria-describedby`; 44 px targets (`h-11`, as
existing auth buttons); the QR code always has the text-key alternative; the backup-code grid wraps to one column under
`sm`; a visible "Copied" status (`role="status"`); no timers on the code step except the server's 10 minutes, which is
stated in the copy.

**Admin user detail**: a "Sign-in security" row (2FA on/off, passkey count) and two actions, "Reset two-factor" and
"Remove passkeys". The users table gets a "2FA" column.

## 7. Tests

- **Unit (vitest)**:
  - `auth-method` classification
  - the `requireAdmin` decision as a pure function (enrolled × authMethod × enforce flag)
  - `auth-errors` mappings for the new codes
  - manual-key formatting from `totpURI`
  - the backup-code download text
  - email templates (`packages/email/templates.test.ts`)
  - the impersonation-guard matcher
- **Integration (`auth.int.test.ts`, real Postgres)**. Generate codes with `createOTP(base32.decode(secret)).totp()`
  from `@better-auth/utils`:
  - signUp → `enableTwoFactor` → `verifyTOTP` sets `twoFactorEnabled`
  - `signInEmail` returns `twoFactorRedirect` and no session cookie
  - verify with the challenge cookie gives a session with `auth_method = "mfa"`
  - a backup code works once
  - 5 bad codes give `TOO_MANY_ATTEMPTS`; 10 give lockout
  - `disable` + full trust revocation
  - the admin `resetSecondFactor` service clears the rows and sessions and writes the audit row
  - the impersonation guard refuses `/passkey/generate-register-options` and `/two-factor/enable`
- **E2E (Playwright, Chromium)**:
  - `two-factor.spec.ts`: enrol from Settings, read the manual key from the page, generate a code in the test, then
    sign out, sign in, enter a code and land in `/app`. Also covers backup-code sign-in, and that a trusted device
    skips the code on the next sign-in. Each worker already has its own IP header, which keeps the 3-per-10 s limit
    clear.
  - `passkey.spec.ts`:
    - Set up a CDP virtual authenticator: `const cdp = await page.context().newCDPSession(page)`,
      `WebAuthn.enable`, then `WebAuthn.addVirtualAuthenticator` with
      `{ protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
isUserVerified: true, automaticPresenceSimulation: true }`.
    - Add a passkey in Settings and assert it with `WebAuthn.getCredentials`.
    - Sign out, use "Sign in with a passkey" and land in `/app`. Then rename and remove it.
    - With `isUserVerified: false`, sign-in must fail (proves the UV check).
    - CI's `BETTER_AUTH_URL=http://localhost:3004` gives rpID `localhost`, which WebAuthn accepts over http.
  - `admin.spec.ts` additions, with `ADMIN_MFA_ENFORCE=true` for this spec:
    - an admin without a factor is sent to Security
    - an admin with a passkey but a password session sees `/admin/verify`
    - after passkey step-up, `/admin` loads
    - the reset action writes an audit entry
  - Conditional-UI autofill isn't reliably drivable in Playwright. Cover it with a unit test of the call guard and a
    manual check on Safari/iOS and Chrome/Android before release.

## 8. Privacy page and audit log

- **Privacy, "What we collect"**: add "If you turn on two-step sign-in, we store your authenticator secret and backup
  codes, encrypted. If you add a passkey, we store its public key, a credential ID, the authenticator model and when
  you added it. Your fingerprint, face or device PIN never leave your device."
- **Privacy, technical data**: add a 10-minute sign-in challenge cookie and an optional 30-day trusted-device cookie.
- **Privacy, "Who processes"**: add "Administrators can reset two-step sign-in or remove passkeys on your account,
  for example when you've lost access. They can't see your codes or keys."
- **Privacy, retention**: deleted with the account (cascade).
- **Admin audit log**:
  - New actions `user.two_factor_reset` and `user.passkeys_remove`, with metadata `{ passkeys: n }`. `_failed`
    variants come for free from `audited()`.
  - Labels and filters on `/admin/audit`. A required reason.
- **User self-service changes**: not in `admin_audit_log`, which records admin actions. Emit wide log events instead
  (`auth.two_factor_enabled|disabled|backup_codes_regenerated|backup_code_used`, `auth.passkey_added|removed`,
  `auth.admin_step_up`), plus the security emails.
- **Docs**: `docs/deployment.md` gets the secret-rotation caveat for TOTP, the `ADMIN_MFA_ENFORCE` flag, the rpID and
  domain note and the sole-admin recovery SQL.

## 9. Tracks (PR-sized)

**PR A — Two-factor (TOTP + backup codes)**. Can ship alone.

- twoFactor plugin plus client plugin; first migration (user, session `auth_method`, `two_factor`)
- `authMethod` session hook; impersonation guard for `/two-factor/*`
- the `/sign-in/two-factor` step and the `CredentialsForm` redirect
- the Security page: authenticator card and devices card
- security emails
- `resetSecondFactor` core service and admin action, with audit
- privacy copy; the rotation note in deployment docs
- unit, integration and e2e TOTP tests
- New dependencies: `uqr@0.1.3`, and `@better-auth/utils@0.5.1` (dev)

**PR B — Passkeys + admin enforcement** (after A)

- `@better-auth/passkey@1.7.14` with rpID, origin, UV required and rate limits; second migration
- the Passkeys card; the sign-in button and autofill
- the impersonation guard for `/passkey/*`; passkey emails
- the admin "Remove passkeys" action and admin detail row
- `requireAdmin` enforcement, `/admin/verify` step-up and `ADMIN_MFA_ENFORCE`
- privacy and audit additions
- virtual-authenticator e2e and the admin e2e

Validation for each PR: the full CI chain from `AGENTS.md` plus `scripts/test.sh`.

## 10. Owner decisions

1. **Passkey rpID**:
   - The production host from `BETTER_AUTH_URL` (simplest).
   - Or the registrable apex (for example `example.com`) through a `PASSKEY_RP_ID` env. That survives a later move
     to another subdomain.
   - **Changing the rpID later orphans every passkey.** Preview deploys: passkeys work only where the preview's
     `BETTER_AUTH_URL` equals its own URL. `vercel.app` can't be an rpID, so passkeys are per-preview at most.
2. **Admin enforcement**: require it (recommended), and is "passkey, or password+TOTP" right? An OAuth-only admin
   would then need a passkey.
3. **`session.freshAge`**: lower it from 24 h to 1 h? It applies to passkey registration, disabling 2FA and account
   deletion. Recommended yes, but users re-sign-in more often for those actions.
4. **Email OTP as a 2FA method**: recommend **no**.
5. **Trusted-device default**: 30 days, opt-in checkbox (recommended). Or shorter, or not offered to admins.
6. **Nudges**: is the Settings card plus a one-time `/app` callout enough, or should we skip the callout?
7. **Migrations against production** (both): need your go when they run.
