# Data protection

What Receipt OCR stores, how sensitive each kind of data is, and how it is protected: in transit, at rest, by
hashing or encryption, by retention and by access control. This page is the reference for those rules. Sections
describe the code as it is; anything not built is under [Planned](#planned).

## Contents

- [Rules](#rules)
- [Data classes](#data-classes)
- [Protection by class](#protection-by-class)
- [Keys and secrets](#keys-and-secrets)
- [Retention](#retention)
- [Access](#access)
- [Backups](#backups)
- [Logs and telemetry](#logs-and-telemetry)
- [Planned](#planned)
- [Standards this follows](#standards-this-follows)

## Rules

1. **Don't store what the app doesn't use.** The cheapest protection is absence.
2. **Hash what only needs checking; seal what must be replayed; leave the rest as plain columns.** A verifier
   (password, emailed token, one-time code) is stored one-way. A secret the server must use again (a TOTP seed) is
   encrypted by the application. Business data that is searched, summed and exported is not application-encrypted;
   it is protected by the provider's encryption, access control, retention and backups.
3. **Keys live apart from the data.** Application keys are in the host's secret store, never in the database, the
   repository or a backup.
4. **Every class has a retention rule,** and the privacy policy states it.
5. **Logs carry ids, not content.** Emails, names, receipt text, file names and tokens never reach logs, Sentry or
   PostHog.

## Data classes

| Class                   | What it holds                                                                                                                                                                                             | Sensitivity                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| C1 Credentials          | Passwords, session tokens, verification and reset tokens, step-up codes, TOTP seeds, backup codes, application keys. Google and GitHub tokens are not stored                                              | Highest: each one grants access       |
| C2 Customer content     | Receipt files in object storage; `receipts` (merchant, amounts, dates, seller tax id, the structured extraction, file name); `receipt_items`; support messages                                            | High: financial records and free text |
| C3 Identity and contact | `user` (email, name, image); `invitation.email`; session IP and user agent; `step_up_events.ip`; the admin audit log (actor email, IP, target, reason); a contact-form visitor's address in a job payload | Personal data                         |
| C4 Billing identifiers  | Paddle customer, subscription and transaction ids; normalized webhook events. No card data, address or tax number: Paddle is the merchant of record                                                       | Low: identifiers, not credentials     |
| C5 Operational          | The usage ledger (`ocr_rounds`, `ocr_calls`), job records, rate-limit counters, settings                                                                                                                  | Low: ids, counts and states           |

The tables behind each class are in the [data model](../data-model.md).

## Protection by class

**In transit, every class.** Browsers reach the app over HTTPS with HSTS (two years, subdomains;
[`next.config.ts`](../../../apps/web/next.config.ts)). The app reaches Postgres over TLS verified against the
provider's CA when `DATABASE_SSL_CA` is set ([db.md](../db.md#design-principles-and-invariants)); object storage,
the model providers, Resend and Paddle over HTTPS. Receipt images reach the browser only through signed URLs valid
for at most 15 minutes ([storage.md](../storage.md)).

**At rest, every class.** The database provider encrypts the disk (AES-256) and the object store encrypts each
object (AES-256-GCM, provider-managed keys). That protects against loss of the provider's media, not against a
reader of the database. The table below is what the application adds.

| Data                                        | Stored as                                                                                                              | Why                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Password                                    | scrypt, random salt per hash (Better Auth)                                                                             | Verifier                                                     |
| Verification, reset and trust-device tokens | SHA-256 of the token (`verification.storeIdentifier`)                                                                  | Verifier; the token is long and random                       |
| Emailed step-up code                        | HMAC-SHA-256 under the auth secret, bound to the session, with an attempt cap                                          | Verifier; six digits need a keyed hash                       |
| Session token                               | Plain. The cookie must also carry an HMAC under the auth secret, so the row alone signs nobody in                      | Looked up on every request                                   |
| TOTP seed, backup codes                     | Sealed: XChaCha20-Poly1305 under the versioned auth secret                                                             | The server must read them to check a code                    |
| Google and GitHub tokens                    | Not stored: the account hooks null access, refresh and id tokens and their expiries before every write                 | Not used by the app; sign-in matches the provider account id |
| Passkey public keys                         | Plain                                                                                                                  | Public by design                                             |
| Rate-limit keys that name an address        | SHA-256 of the normalized address                                                                                      | Keeps addresses out of a counter table; rows are short-lived |
| C2, C3, C4, C5 columns                      | Plain columns                                                                                                          | Queried, aggregated, searched and exported                   |
| Receipt files                               | Objects keyed `users/<user id>/receipts/<receipt id>.<ext>`: ids only, never a file name or an address                 | The key appears in URLs and logs                             |
| Job payloads                                | Ids and object keys. The one payload with an address (the contact-form reply) is emptied when the job succeeds or dies | Job rows outlive the work                                    |

**What is not application-encrypted, and why.** Receipts, line items and support messages. The product sums
amounts, searches merchants, groups and deduplicates receipts, and admins triage support text; none of that works
on ciphertext without deterministic encryption or blind indexes, which leak equality and add keys to manage. An
application key would also sit in the same environment as the app, so it would stop a reader of a database dump but
not a compromised app. Grants, retention and encrypted backups address the dump; nothing in this class is a bearer
secret. Data that would change this answer (card numbers, bank account numbers, government ids) is not stored.

**Provider tokens.** Better Auth would store each Google or GitHub sign-in's access, refresh and id tokens. The
`account` create and update hooks null them, `maintenance.purge` nulls any that reach a row anyway (an older release
still serving during a migration), `account.updateAccountOnSignIn` is off so a sign-in doesn't rewrite the row, and `/get-access-token`, `/refresh-token` and `/account-info` answer 404 (`disabledPaths`). Without the tokens
the app cannot revoke the provider's grant when an account is deleted; users remove it in their Google or GitHub
settings.

**Uploaded files keep their metadata.** The browser re-encodes most images, which removes EXIF and GPS. PDFs, HEIC
outside Safari, shared files and direct API uploads are stored, and sent to the model provider, as received.

## Keys and secrets

| Key                                          | Protects                                                                          | Held in           | Rotation                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Auth secret keyring (`BETTER_AUTH_SECRETS`)  | Session cookie signatures; sealed TOTP seeds and backup codes; step-up code HMACs | Host secret store | Versioned, current first. A new version signs everyone out; old versions stay listed for decryption |
| Database credentials                         | All of Postgres                                                                   | Host secret store | On suspicion of exposure or operator change                                                         |
| Object storage keys                          | One bucket per environment                                                        | Host secret store | Same                                                                                                |
| Provider keys (models, email, billing, cron) | Calls to those services, webhook verification                                     | Host secret store | Same; each provider's console                                                                       |
| Disk and object encryption keys              | Storage media                                                                     | The providers     | Provider-managed                                                                                    |

- The host secret store is Vercel's write-only Secret variables; values cannot be read back. Operator copies are
  covered in [secrets.md](../../secrets.md). The full variable list is in
  [deployment.md](../../deployment.md#4-environment-variables).
- **Rotate the auth secret** by adding a version, never by replacing one
  ([runbook](../../deployment.md#rotating-the-auth-secret)). Rotate on suspected exposure or an operator leaving,
  and otherwise about once a year. A version is removed only when no `two_factor` row is sealed under it; the
  runbook has the count query. If a secret and a copy of the database are both exposed, re-sealing does not help:
  affected users re-enrol two-step sign-in.
- The auth secret and a database backup are never kept in the same place: a backup holds the sealed values.
- Better Auth's cipher binds no context (no AAD) to a value. It is used only where Better Auth owns the column.

## Retention

| Data                                                                          | Kept                                                                     | Enforced by                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Account, workspaces, receipts, files                                          | Until the user deletes them                                              | Delete flows ([data model](../data-model.md#what-happens-on-delete)); files by `storage.delete` jobs queued with the row delete |
| Support messages                                                              | 12 months after closing, or after the last change if never closed        | `maintenance.purge`, daily                                                                                                      |
| Verification rows                                                             | Until expiry                                                             | Better Auth deletes expired rows on each lookup                                                                                 |
| Rate-limit counters                                                           | About an hour                                                            | Better Auth prunes rows older than its longest window                                                                           |
| Usage ledger                                                                  | Indefinitely; unlinked from the user and workspace when they are deleted | `SET NULL` foreign keys                                                                                                         |
| Billing records                                                               | While the workspace exists; afterwards without the workspace's identity  | Delete flows                                                                                                                    |
| Sessions, step-up codes and events, job records, invitations, admin audit log | No limit yet                                                             | See [Planned](#planned)                                                                                                         |

`maintenance.purge` is one job kind that runs once a day through the [job queue](../flows/jobs.md) and deletes in
batches of 500. New retention rules are added to it; nothing is deleted by a database scheduler.

## Access

- **One database role.** The app, migrations and Better Auth connect as the table owner. `DATABASE_URL` goes
  through the pooler; `DIRECT_URL` is for migrations only.
- **Row-level security is on for every table, with no policies** ([db.md](../db.md#design-principles-and-invariants)).
  The provider's API roles `anon` and `authenticated` therefore read no rows. `service_role` bypasses RLS, so RLS
  is not the control for that key.
- **The app never uses Supabase's Data API.** Setting up a database includes removing `public` from the API's
  exposed schemas ([deployment.md](../../deployment.md)).
- **Schema changes go through migrations only,** never the provider's table editor: objects created there receive
  the provider's default grants.
- **Object storage is private:** no public access, no custom domain, one access key scoped to one bucket per
  environment ([production-environment.md](../../production-environment.md)).
- **Tenant scoping is in the application:** every receipt query is scoped to the caller's workspace
  ([core.md](../core.md)). Platform admins act through audited admin actions
  ([admin actions](../flows/admin-actions.md)).
- **Provider consoles** (database, hosting, storage) can read everything their service holds. Access is the
  owner's accounts.

## Backups

The database has no automated backup on the current plan. A backup, when there is one, contains every class above,
is encrypted, and is stored apart from the auth secret. Object storage has no second copy.

## Logs and telemetry

- **Wide events** are built from a typed allowlist ([observability](../flows/observability.md)). A field is
  logged only if the schema names it; unknown keys are dropped. Errors are described with `errorFields(error)`,
  never a message string. A new field is added to the schema with a note on whether it can carry personal data.
- **Sentry** events are rebuilt from an allowlist: no user, headers, cookies, request bodies or frame variables.
- **PostHog** is server-side, named events only, with no person properties and no GeoIP.
- **Job records** hold ids, states and short error codes, never free text.
- **Third parties** hold what they deliver: the email provider the messages it sent, Paddle the billing identity,
  the model providers each uploaded file for their stated retention. The privacy policy lists them.

## Planned

In build order. Reasons and sources are in the
[principal review](../../reviews/2026-11-14-data-at-rest-principal.md).

1. TODO (2026-11-14): switch the Data API off, revoke `anon`, `authenticated` and `service_role` grants and default
   privileges in a guarded migration, assert it in `rls.int.test.ts`, and enforce TLS on the database.
2. TODO (2026-11-14): extend `maintenance.purge`: sessions and step-up codes 1 day after expiry; step-up events 90
   days; finished jobs 30 days (keeping each user's welcome-email record); invitations 30 days after expiry or an
   answer; admin audit log 2 years. Empty the contact-reply payload on every terminal path. State the periods, and
   that files keep their metadata, in the privacy policy.
3. TODO (2026-11-14): test whether Better Auth's rate-limit pruning shortens the app's 24-hour limits; if so, move
   the app's counters to their own table.
4. TODO (2026-11-14): owner decision on raising the password hash to an OWASP-listed scrypt configuration.
5. TODO (2026-11-14): database backups with a restore test (STATUS D1).
6. TODO (2026-11-14, after launch): a least-privilege database role for the app (DML only, `BYPASSRLS`), with migrations
   staying on the owner role.
7. TODO (2026-11-14, with bring-your-own-key): envelope encryption for provider keys (per-value data key, key-encryption key
   from `DATA_ENCRYPTION_KEYS`, AAD bound to table, column and row), a KMS-held key-encryption key, and one re-seal
   job covering those values and the auth-secret values ([BYOK plan](../../plans/2026-11-07-byok.md)).

Accepted deviations: backup codes are sealed, not hashed (the two-factor plugin cannot hash them); session tokens
are stored plain (Better Auth has no option to hash them).

## Standards this follows

- OWASP ASVS 5.0: V14 Data Protection (classification and documented protection per class, 14.1.1, 14.1.2,
  14.2.4), V11 Cryptography (key inventory, authenticated encryption, password KDF), V13 Configuration (secret
  management, least-privilege service accounts).
- OWASP Cryptographic Storage and Password Storage cheat sheets.
- NIST SP 800-63B-4 (verifier storage for passwords, look-up secrets and OTP keys) and SP 800-57 Part 1 (key
  lifecycle).
- GDPR Articles 5(1)(e) and 13(2)(a): storage limitation, and stating retention periods in the privacy notice.
