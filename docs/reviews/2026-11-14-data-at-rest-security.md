# Data at rest security review — 2026-11-14

## Security review — Changes requested

Scope: how sensitive data is stored at rest in Postgres, R2, job payloads and telemetry, on `main` at `e1739bd`.
Read-only. Builds on the [11-07 full review](2026-11-07-full-security.md), the
[11-09 database review](2026-11-09-database-review.md) and the [11-13 billing review](2026-11-13-billing-security.md),
and does not repeat their findings except to rank them here.

Method:

- Source read: `packages/db` (all 27 tables), `apps/web/lib/auth*.ts`, `step-up.ts`, `email-limits.ts`,
  `packages/core/src/jobs`, `packages/storage`, the telemetry scrubbers, and Better Auth 1.7.18 as installed
  (`node_modules/.bun/better-auth@1.7.18+…/node_modules/better-auth/dist`, cited below as `ba/`).
- Local compose databases (test data only) inspected read-only through `psql` for stored formats: password hashes,
  session tokens, verification identifiers, rate-limit keys and job payloads by state.
- Better Auth advisories: none newer than the twelve of 2026-11-03, all fixed in 1.7.16.
- Not exercised: staging and production (not probed); a real Google or GitHub sign-in (the local stack has no OAuth
  client), so the `account` token columns are reasoned from library code.

## Owner decisions

1. **Stop storing Google and GitHub tokens** (BYOK plan open question 14). Recommended: yes. We use them for sign-in
   only, and `id_token` is stored in plaintext today (F1).
2. **Turn off the Data API for `public` and revoke the `anon` and `authenticated` grants** (STATUS D2, database
   review M1). Recommended: yes, before the first real user.
3. **Retention periods** for the purge job (F4). Proposed: expired sessions and verification rows after 1 day;
   `rate_limit` after 1 day; `step_up_codes` after 1 day; `step_up_events` after 90 days (keeping what the lockout
   reads); finished `jobs` after 30 days; expired or answered `invitation` rows after 30 days; `admin_audit_log` 2
   years; `billing_events` and `billing_subscriptions` kept while the workspace exists (Paddle is the merchant of
   record and keeps the invoices). The privacy policy changes with it.
4. **No application-layer encryption for receipts, receipt items, support messages or emails.** Recommended: keep
   them as plain columns under disk encryption, access control and retention. Reasons in "What not to encrypt".
5. **`DATA_ENCRYPTION_KEYS` lands with BYOK**, not before. Once F1 is done nothing we store needs our own envelope
   yet. `user_credentials` is dropped as decided.
6. **Backups:** Supabase Pro's daily backups (encrypted by Supabase) or the closed #131 (nightly `pg_dump`
   encrypted with `age`). Either way a dump holds the TOTP secrets sealed under the auth secret, so the auth secret
   and the backups must never sit in the same place.

## Ranked recommendations

| #   | Rank | What                                                                                              | Migration                                           |
| --- | ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| F1  | P0   | Stop storing OAuth access, refresh and id tokens; refuse the endpoints that hand them out         | Data only: null the three token columns             |
| F2  | P0   | Data API off for `public`; revoke `anon`/`authenticated`; assert it in `rls.int.test.ts`          | Guarded `REVOKE` + `ALTER DEFAULT PRIVILEGES`       |
| F3  | P1   | Count sealed values per auth-secret version and re-seal TOTP secrets and backup codes             | None (a job kind)                                   |
| F4  | P1   | Extend `maintenance.purge` to sessions, verification, rate limits, step-up rows, jobs, invitations | `0009`: indexes on the purge scans                  |
| F5  | P1   | Scrub contact-reply payloads on every terminal path, not only succeeded and dead-by-attempt       | None                                                |
| F6  | P2   | Backup codes are reversibly encrypted; NIST wants them hashed                                     | None until replaced                                 |
| F7  | P2   | Password hashing below OWASP's scrypt minimum                                                     | None (rehash on sign-in)                            |
| F8  | P2   | Email hashes in `rate_limit` keys are unkeyed SHA-256                                             | None                                                |
| F9  | P2   | GPS and camera metadata survive on uploads the browser can't re-encode                            | None                                                |
| F10 | P2   | The app connects as `postgres`; a least-privilege role would cap a leaked app credential          | Role + grants, outside Drizzle                      |

## Findings

### F1 · OAuth tokens are stored, and the id token in plaintext. P0

`apps/web/lib/auth.ts:355` sets `account: { encryptOAuthTokens: true }` (Better Auth's default is `false`). That
seals `access_token` and `refresh_token` only. Every write path passes `idToken: account.idToken` through unsealed:
`ba/oauth2/link-account.mjs:82,197,244,301`, against `setTokenUtil` for the other two on the neighbouring lines.
`updateAccountOnSignIn` is on by default, so each sign-in rewrites all three (`link-account.mjs:242-247`).

- **Impact.** A Google id token is a signed JWT carrying the user's email, name, picture and Google subject id, so
  every Google user's profile sits in plaintext in `account.id_token` and in every backup. Anyone with a read of the
  table (a dump, the SQL editor, `supabase_read_only_user`, a future RLS policy mistake) gets it. The sealed access
  and refresh tokens are one secret away: they use XChaCha20-Poly1305 under `SHA-256(auth secret)`, with no AAD
  (`ba/crypto/index.mjs:30-48`), so the auth secret plus a dump opens them.
- **Live exposure.** `/get-access-token` and `/refresh-token` (`ba/api/routes/account.mjs:416,448`) decrypt and
  return a live provider token to any signed-in session. They are blocked only for impersonation
  (`apps/web/lib/step-up-paths.ts:63-64`). A stolen session cookie therefore yields a Google or GitHub token
  (default scopes: profile and email reads). `/account-info` (`account.mjs:542`) makes a provider call with it.
- **We don't need any of it.** No app code reads the columns (searched `apps/web`, `packages/core`); the
  Security settings page dropped the `accountInfo` call.
- **Fix.**
  1. `databaseHooks.account.create.before` and `update.before`: return the data with `accessToken`, `refreshToken`,
     `idToken`, `accessTokenExpiresAt` and `refreshTokenExpiresAt` set to `null` when `providerId` is not
     `credential`. Both run through `createWithHooks`/`updateWithHooks` (`ba/db/internal-adapter.mjs:183,644,745`),
     which covers sign-up, link and the sign-in refresh.
  2. In `hooks.before`, answer `NOT_FOUND` for `/get-access-token`, `/refresh-token` and `/account-info`, as is
     done for `/delete-user/callback`.
  3. Data migration (no schema change; the columns stay because Better Auth's schema names them):
     `update account set access_token = null, refresh_token = null, id_token = null, access_token_expires_at = null,
     refresh_token_expires_at = null where provider_id <> 'credential';`
  4. Tests: a Google-shaped `linkAccount` stores nulls; the three endpoints answer 404; an integration test reads
     the row back.
- Then rotating the auth secret affects only sessions and two-factor rows (F3), and `encryptOAuthTokens` can stay
  on as a guard for any token that slips through.

### F2 · The Data API still reaches `public`. P0

Unchanged since the 11-07 review (H4) and the 11-09 database review (M1): `anon` and `authenticated` hold table
grants on all tables. RLS is enabled on all 27 (counted in the migrations: 23 + 2 + 1 + 1) with no policies, so no
rows are readable today, but the OpenAPI root lists every table and column, and one `CREATE POLICY` would expose
the tables this review is about. Not re-probed (production is out of scope).
Fix as in the database review: remove `public` from the exposed schemas, a guarded migration with
`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated`, the same for sequences and functions,
`ALTER DEFAULT PRIVILEGES … REVOKE`, and a grant assertion in `rls.int.test.ts` that skips on plain Postgres.

### F3 · Nothing tracks or re-seals values under an auth-secret version. P1

Better Auth seals three things with the versioned auth secret (`$ba$<version>$<hex>`, `ba/crypto/index.mjs:42-59`):
the TOTP secret (`ba/plugins/two-factor/index.mjs:192`), the backup codes (`backup-codes/index.mjs:19`) and, until
F1, OAuth tokens. OAuth tokens are re-sealed at the next sign-in. Backup codes are re-sealed only when one is used
(`backup-codes/index.mjs:221`). **TOTP secrets are never re-sealed**: a secret enrolled under version 1 stays under
version 1 for good. Our own step-up opens them the same way (`apps/web/lib/step-up.ts:137`).

- **Impact.** The rotation runbook (`docs/deployment.md`, "Rotating the auth secret", step 3) says to remove an old
  version "only once nothing sealed under them is still needed", but nothing counts that. Removing version 1 locks
  every TOTP user enrolled before the rotation out of two-factor sign-in and step-up. Keeping it forever means a
  leaked old secret still opens those rows.
- **Fix.** A `secrets.reseal-auth` job kind (admin-started, audited, batches of 100 by id, cursor in the payload):
  for `two_factor.secret` and `two_factor.backup_codes` whose prefix is not the current version, open with
  `symmetricDecrypt` from `better-auth/crypto` and write `symmetricEncrypt` output with a compare-and-swap on the old
  value. Admin → Settings shows counts by version (`split_part(secret, '$', 3)`), and the runbook step 3 says to
  run the job and wait for zero. Bare-hex rows (sealed before `BETTER_AUTH_SECRETS`) count as the legacy version.
  This is the same shape as `secrets.rewrap` in the [BYOK plan §9.3](../plans/2026-11-07-byok.md#93-rotation-jobs);
  build one registry for both.

### F4 · Personal data that is never purged. P1

`maintenance.purge` deletes only support messages (`packages/core/src/jobs/kinds/maintenance-purge.ts:73`).
Everything below grows without bound (database review M2, still open):

| Table                         | Personal data                                        | Proposed rule                                                   |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| `session`                     | IP address, user agent, plaintext token              | Delete 1 day after `expires_at`                                 |
| `verification`                | Hashed identifiers; values are user ids or WebAuthn challenges | Delete 1 day after `expires_at`                       |
| `rate_limit`                  | Hashed emails, IPs                                   | Delete when `last_request` is over a day old                    |
| `step_up_codes`               | HMAC of a 6-digit code                               | Delete 1 day after `expires_at`                                 |
| `step_up_events`              | IP per check                                         | 90 days, keeping the rows the lockout reads (STATUS proposal)   |
| `jobs` (succeeded, dead, cancelled) | Payloads (see F5), user ids                    | Delete 30 days after `finished_at`                              |
| `invitation`                  | Invitee email                                        | Delete 30 days after `expires_at` or an answer                  |
| `admin_audit_log`             | Actor email, IP, target label                        | 2 years (decision 3); append-only trigger stays the plan (P2-2) |

Migration `0009`: indexes for the scans that need them (`session (expires_at)`, `verification (expires_at)`,
`step_up_codes (expires_at)` (database review M5), a partial `jobs (finished_at) where state in (…)`). Same batched
loop as support messages; one count per table in the wide event.

### F5 · Contact-reply payloads keep the visitor's email on two paths. P1

`email.contact-reply` stores `{ to, name, topic }` (`kinds/contact-reply.ts:23-32`) and sets `scrubPayload`, which
empties the payload only in `settle` for succeeded and dead (`queue.ts:290-292`). Two terminal paths skip it:

- `reap` (`queue.ts:309-324`) marks a job `dead` after a lost lease with the payload intact.
- `cancel` (`queue.ts:327-335`) and the admin's `cancelQueuedJob` (`admin.ts:170`) leave a `cancelled` job's payload.

Locally, the reliability database holds `dead` and `cancelled` jobs with non-empty payloads (other kinds, but the
same code path). Fix: apply the scrub in `reap` and `cancel` when the kind's definition has `scrubPayload` (or
scrub by kind in SQL from a list exported by the registry), with a test per path. F4's 30-day job purge is the
backstop.

### F6 · Backup codes are encrypted, not hashed. P2

Ten 10-character codes from 62 symbols (about 59 bits each, `backup-codes/index.mjs:14`) are stored as one sealed
JSON array (`storeBackupCodes: "encrypted"`, the plugin default) and checked with `codes.includes(code)` after
decryption (`backup-codes/index.mjs:33-41`). NIST SP 800-63B §5.1.2.2 requires look-up secrets under 112 bits to be
"salted and hashed using a suitable one-way key derivation function". Better Auth's custom
`storeBackupCodes: { encrypt, decrypt }` can't hash: verification compares the user's input with whatever `decrypt`
returns. With the auth secret kept apart from the database this is "strongly protected"; with both, the codes are
readable. Options: accept (recommended for now; noted in the threat model), or own the backup codes in
`packages/core/src/step-up` with a salted scrypt hash per code and keep the plugin's endpoints blocked. Revisit on a
Better Auth upgrade that adds hashing.

### F7 · Password hashing is a quarter of OWASP's scrypt minimum. P2

Better Auth hashes with scrypt `N=16384, r=16, p=1, dkLen=64` and a random salt
(`@better-auth/utils/dist/password.node.mjs:4-8`), stored as `<hex salt>:<hex key>` (confirmed on local rows).
OWASP's Password Storage Cheat Sheet asks for at least `N=2^17, r=8, p=1`: four times the work and memory of ours
(2^18 against 2^20 for `N·r`). Fix if wanted: `emailAndPassword.password.{ hash, verify }` with the OWASP
parameters and a prefix, verify the old format too, and rehash on a successful sign-in. Measure sign-in latency on
a Vercel function first (128 MiB per hash).

### F8 · Email hashes in rate-limit keys are unkeyed. P2

`email-limits.ts:23,106` and `packages/core/src/newsletter.ts:135` key `rate_limit` rows by plain SHA-256 of the
address. Anyone holding the table can confirm whether a known address signed in or asked for an email recently. Fix:
HMAC under a server secret (the step-up code already does this, `step-up.ts:63-65`). The rows are short-lived once
F4 purges them.

### F9 · Camera metadata on some uploads. P2

The browser re-encodes images, which strips EXIF and GPS (`apps/web/lib/upload-prep.ts:259-263`). PDFs, HEIC
outside Safari, failed encodes, the share target and any direct POST arrive unchanged, so their GPS position is
stored in R2 next to the receipt. Fix: strip metadata on the server for JPEG/PNG/WebP (segment removal, no
re-encode), or say in the privacy policy that originals are stored as sent.

### F10 · One database role for everything. P2

The app, migrations and the auth adapter all use `postgres`, which owns the tables and bypasses RLS. A leaked
`DATABASE_URL` reads and changes every table, sealed columns included. A role with DML on the app tables and
nothing else (no DDL, no `pg_read_server_files`) caps that; migrations keep `DIRECT_URL` as the owner. Low urgency
before launch, worth doing with F2.

## Inventory

How each sensitive column is stored. "Disk" means Supabase's AES-256 encryption at rest only. Every table is
readable by the app role; none by `anon`/`authenticated` today (RLS, no policies; F2 removes the grants).

| Table · column                                                  | Holds                                                    | At rest                                                                                         | Retention                      | Needed?                              |
| --------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------ |
| `account.password`                                              | Password                                                 | scrypt, salted (F7)                                                                             | Account                        | Yes                                  |
| `account.access_token`, `refresh_token`                         | Provider tokens                                          | Sealed under the auth secret                                                                    | Account                        | **No** (F1)                          |
| `account.id_token`                                              | Provider JWT with email, name, picture                   | **Plaintext**                                                                                   | Account                        | **No** (F1)                          |
| `session.token`                                                 | Session id                                               | Plaintext; the cookie carries it with an HMAC under the auth secret (`ba/cookies/index.mjs:174`) | Never purged (F4)              | Yes                                  |
| `session.ip_address`, `user_agent`                              | Device data                                              | Disk                                                                                            | Never purged (F4)              | Yes while live (device list)         |
| `verification.identifier`                                       | Reset, verification, trust-device tokens                 | SHA-256, base64url (`auth.ts:351`, `ba/db/verification-token-storage.mjs:4-11`)                 | Never purged (F4)              | Yes                                  |
| `verification.value`                                            | User ids, WebAuthn challenges                            | Disk                                                                                            | Never purged (F4)              | Yes                                  |
| `two_factor.secret`                                             | TOTP seed                                                | Sealed under the auth secret (F3)                                                               | While enrolled                 | Yes; must be reversible              |
| `two_factor.backup_codes`                                       | Recovery codes                                           | Sealed under the auth secret (F6)                                                               | While enrolled                 | Yes                                  |
| `passkey.public_key`, `credential_id`                           | Public key material                                      | Disk; not secret                                                                                | While registered               | Yes                                  |
| `step_up_codes.code_hash`                                       | Emailed 6-digit code                                     | HMAC-SHA256 under the auth secret, bound to the session (`step-up.ts:63-65`)                    | Never purged (F4)              | Yes, for 10 minutes                  |
| `step_up_events.ip`                                             | IP per check                                             | Disk                                                                                            | Account (F4)                   | 90 days                              |
| `rate_limit.key`                                                | IPs, SHA-256 of emails                                   | Disk (F8)                                                                                       | Never purged (F4)              | Short-lived                          |
| `user.email`, `name`, `image`, `ban_reason`                     | Identity                                                 | Disk                                                                                            | Account                        | Yes                                  |
| `invitation.email`                                              | Invitee address                                          | Disk                                                                                            | Never purged (F4)              | Until answered                       |
| `support_messages.name`, `email`, `message`                     | Free text from users and visitors                        | Disk                                                                                            | 12 months after closing        | Yes                                  |
| `jobs.payload` (`email.contact-reply`)                          | Visitor email, name                                      | Disk; emptied on success and dead (F5)                                                          | Never purged (F4)              | Until sent                           |
| `jobs.payload` (other kinds)                                    | Ids, object keys                                         | Disk                                                                                            | Never purged (F4)              | Until finished                       |
| `billing_events.payload`                                        | Normalized Paddle event: ids, states, dates              | Disk; no email, card or address (11-13 review)                                                  | Workspace                      | Yes (ordering, audit)                |
| `billing_subscriptions`, `billing_checkouts`                    | Paddle customer, subscription and transaction ids        | Disk; identifiers, not credentials                                                              | Workspace                      | Yes                                  |
| `receipts` (merchant, amounts, `merchant_tax_id`, `raw_json`, `file_name`) | Financial records; seller's tax id; the structured extraction; the client's file name | Disk                                                              | Workspace                      | Yes                                  |
| `receipts.image_object_key`                                     | `users/<user id>/receipts/<receipt id>.<ext>`            | Disk; ids only (`packages/storage/src/index.ts:52-54`)                                          | Workspace                      | Yes                                  |
| `receipt_items.name`                                            | Line text                                                | Disk                                                                                            | Workspace                      | Yes                                  |
| `ocr_rounds`, `ocr_calls`                                       | Ids, models, token counts, cost                          | Disk; no content                                                                                | Ledger (kept)                  | Yes                                  |
| `admin_audit_log`                                               | Actor email, IP, target label, reason                    | Disk                                                                                            | Forever (F4)                   | Yes                                  |
| `user_credentials`                                              | Nothing (empty)                                          | —                                                                                               | —                              | Drop (decided)                       |
| Newsletter                                                      | No table; subscribers live in Resend; tokens are HMACs (`newsletter.ts:46`) | —                                                            | Resend                         | —                                    |

## Object storage

- **Encryption.** R2 encrypts every object and its metadata at rest with AES-256-GCM under Cloudflare-managed keys
  [C1]. SSE-C is supported [C2], but every read then needs the key in request headers, which an `<img>` loading a
  signed URL can't send; images would have to stream through the app. Not worth it at our threat model.
- **Privacy.** Public access off, no custom domain, no CORS, a token scoped to one bucket
  (`docs/production-environment.md`, R2 section). Not re-checked in the dashboard.
- **Signed URLs.** 10 minutes plus a 5-minute signing window, so at most 15 minutes, with the content type and
  disposition pinned (`packages/storage/src/index.ts:125-168`).
- **Keys.** `users/<user id>/receipts/<receipt id>.<ext>`: opaque ids and the sniffed type, never the file name or
  an email. The user id shows in the user's own signed URL, which reveals nothing they don't have.
- **Metadata.** See F9.

## Logs, telemetry and backups

- **Wide events** are built from a typed allowlist (`packages/core/src/telemetry/schema.ts`), which excludes
  emails, names, receipt text, file names and tokens. No `logger` call passes an email, IP, token or password field
  (searched).
- **Sentry** rebuilds each event from an allowlist and drops user, headers, cookies, bodies and frame variables
  (`apps/web/lib/telemetry/sentry-event.ts`); transactions are dropped on the server.
- **PostHog** is server-side only, named events, no GeoIP, `privacyMode` on, no person properties
  (`apps/web/lib/telemetry/posthog.ts`).
- **Job payloads** after completion: see F5.
- **Backups.** None on Supabase Free [S3]; see decision 6. A backup holds everything in the inventory; F1 removes
  the plaintext id tokens from it, and F3 keeps old auth secrets from being needed to restore one.
- **Third parties** hold copies of what they deliver: Resend the sent emails (welcome, contact auto-reply, support
  notice with a link only), Paddle the billing identity. Out of scope here; listed in the privacy policy.

## What not to encrypt, and why

Application-layer encryption protects against a reader of the database who does not also hold the app's
environment: a stolen dump or backup, the SQL editor, a read-only role, a Data API mistake. It does nothing against
a compromised app, which holds the key. For receipts and support messages it would also break what the product
does: totals and the spend dashboard aggregate amounts, history searches merchants, grouping and duplicate checks
compare fields, and admins triage support text. Blind indexes or deterministic encryption to keep search would
leak equality and add a key to manage. The better controls for this data are F2 (no outside path to the tables),
F10 (a narrow role), retention (F4) and encrypted backups (decision 6). Credentials are different: they are
bearer secrets, nothing queries them, and they are few, so they are sealed or not stored at all.

Supabase's own column encryption is not an option: Supabase "does not recommend" pgsodium, which "will be
deprecated", nor Transparent Column Encryption, "due to their high level of operational complexity and
misconfiguration risk" [S2]. Vault is unaffected [S2], but it keeps the key with the data provider; the BYOK plan
already rejects it (§9.2 option c).

## What the BYOK plan should reuse

- Build `packages/core/src/secrets` (seal/open, AES-256-GCM per-value DEK, KEK from `DATA_ENCRYPTION_KEYS`,
  AAD bound to table, column and row id) exactly as in BYOK §9.1. Better Auth's cipher has no AAD
  (`ba/crypto/index.mjs:30-35`), so do not reuse it for our values.
- One registry of sealed columns with per-version counts, an Admin view and a re-seal job, covering both
  `DATA_ENCRYPTION_KEYS` values and the auth-secret values of F3. Rotation stops being a guess.
- Key the `fingerprint` HMAC and F8's email digests from separate, versioned secrets, not the auth secret.
- Startup validation of the key list in `lib/env.ts`, like `BETTER_AUTH_SECRETS`.

## Verified secure

- **Verification tokens** are stored as SHA-256 hashes, including trust-device rows under their own prefix
  (`auth.ts:351`; 12 of 13 local rows are 43-character base64url digests, the other an integration test's direct insert).
- **Step-up email codes** are an HMAC under the auth secret, bound to the session, compared in constant time, with
  an attempt cap (`step-up.ts:63-65`, `packages/core/src/step-up/store.ts:215-227`).
- **Passwords** are salted scrypt, never reversible (local rows match `<32 hex>:<128 hex>`; strength in F7).
- **TOTP secrets** are sealed, and `/two-factor/get-totp-uri` is refused (`auth-two-factor.ts:53`).
  `viewBackupCodes` is server-only (`backup-codes/index.mjs:324`).
- **Session tokens** in the database are not usable alone: the cookie must carry an HMAC under the auth secret
  (`ba/cookies/index.mjs:174`), and the bearer plugin is not installed. Better Auth 1.7.18 has no option to hash
  them; OWASP's one-way verifier [O3] would need a plugin. Accepted.
- **Rate-limit email keys** hold no addresses (local: 61 `email:` rows, none with `@`); strength in F8.
- **Billing payloads** hold ids and states only (11-13 review).
- **Object keys** carry no names or emails; signed URLs last at most 15 minutes.
- **RLS** is enabled on all 27 tables (migrations).

## Sources

All checked 2026-11-14.

- [S1] Supabase, Security: "All customer data is encrypted at rest with AES-256 and in transit via TLS."
  <https://supabase.com/security>
- [S2] Supabase docs, pgsodium (pending deprecation), and Vault:
  <https://supabase.com/docs/guides/database/extensions/pgsodium>,
  <https://supabase.com/docs/guides/database/vault>
- [S3] Supabase, Security: "All paid customer databases are backed up every day." <https://supabase.com/security>;
  backups: <https://supabase.com/docs/guides/platform/backups>
- [C1] Cloudflare R2, Data security: objects and metadata encrypted at rest with AES-256, GCM mode.
  <https://developers.cloudflare.com/r2/reference/data-security/>
- [C2] Cloudflare R2, SSE-C: <https://developers.cloudflare.com/r2/examples/ssec/>
- [B1] Better Auth options reference, `account.encryptOAuthTokens` (default `false`), `updateAccountOnSignIn`,
  `verification.storeIdentifier`: <https://www.better-auth.com/docs/reference/options>
- [O1] OWASP Password Storage Cheat Sheet (scrypt minimum `N=2^17, r=8, p=1`):
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- [O2] OWASP Multifactor Authentication Cheat Sheet (do not store OTPs in long-term plaintext):
  <https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html>
- [O3] OWASP Session Management Cheat Sheet, server-side token storage:
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- [N1] NIST SP 800-63B §5.1.2.2 (look-up secrets), §5.1.4.2 (OTP keys "strongly protected"):
  <https://pages.nist.gov/800-63-3/sp800-63b.html>
- Envelope encryption and rotation: [BYOK plan §9](../plans/2026-11-07-byok.md#9-key-rotation-and-encryption-at-rest)
  and its sources (OWASP Cryptographic Storage and Key Management, NIST SP 800-57, Google Cloud KMS, AWS KMS).
