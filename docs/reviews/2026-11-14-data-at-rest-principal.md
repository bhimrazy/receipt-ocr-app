# Data at rest: principal-engineer second opinion (2026-11-14)

A review of the plan in [the data-at-rest security review](2026-11-14-data-at-rest-security.md) (PR #267), item by
item: is it right, is it the simplest standard way, and what is missing. The standing reference that comes out of it
is [Data protection](../architecture/security/data-protection.md).

Method: read-only. Better Auth 1.7.18 as installed (`node_modules/.bun/better-auth@1.7.18+…/dist`, cited as `ba/`),
`apps/web/lib/auth*.ts`, `packages/core/src/jobs`, `packages/db/src`, `apps/web/drizzle`, and the sources at the end
(all checked 2026-11-14). Two things were run: a throwaway in-memory Better Auth instance to prove the F1 mechanism,
and a local scrypt timing. Not verified: staging and production (settings, grants, TLS mode), a real Google or GitHub
sign-in, and the rate-limit finding M1, which is read from source only.

## Owner decisions that change

The plan is sound. Five things change; everything else stands as accepted.

1. **F1 uses two Better Auth options, not custom middleware.** `disabledPaths` for the three endpoints and
   `account.updateAccountOnSignIn: false`, plus the two database hooks (there is no "don't store tokens" option).
   Accept one consequence: without stored tokens we cannot revoke the provider's grant when an account is deleted
   (we never did).
2. **F2 covers `service_role` too, and the Data API is switched off, not only un-exposed.** `service_role` bypasses
   RLS, so "RLS on, no policies" does not protect against that key.
3. **No re-seal job (F3).** Old auth-secret versions stay in the keyring, which is what a KMS does. The runbook
   already has the rule and the count query. Re-sealing arrives with BYOK's rewrap job, not before.
4. **The purge is smaller than proposed.** Better Auth already prunes `verification` and `rate_limit`, and the
   indexes proposed for migration `0009` mostly exist. The jobs purge must keep `email.welcome` rows, or users get a
   second welcome email. F4 needs no migration.
5. **F8 dropped, F9 becomes a privacy-page sentence, F10 moves after launch.** F7 (password hashing) is a real gap
   with a 20-line fix: decide yes or no with the timings below.

One new decision: **M1**, our 24-hour rate limits are probably being reset after an hour (see "Missed").

## Verdicts

| Item                    | Verdict                | Simplest correct mechanism                                                                                                                                                         | Source               |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| F1 store no tokens      | Keep, simplify         | `databaseHooks.account.{create,update}.before` null the token keys present; `updateAccountOnSignIn: false`; `disabledPaths`; data migration                                        | [B1] [O4]            |
| F2 Data API             | Keep, widen            | Dashboard: Data API off. Guarded migration: revoke from `anon`, `authenticated`, `service_role`; `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`                                      | [S4] [S5]            |
| Retention periods       | Keep                   | As proposed. Privacy page states each period or its criterion                                                                                                                      | [G1] [G2] [A1]       |
| Retention mechanism     | Keep, shrink           | The one daily batched `maintenance.purge`; no `pg_cron`, no partitioning, no new index                                                                                             | database skill rule 1 |
| F5 scrub on reap/cancel | Keep                   | `payload = '{}'` in `reap` (dead branch only) and `cancel` for kinds with `scrubPayload`                                                                                           | [O4]                 |
| F3 re-seal job          | Drop for now           | Keep old versions listed; runbook count query; re-seal with BYOK's rewrap; re-enrol TOTP if a secret and the database both leak                                                    | [K1] [O4] [B3]       |
| F6 backup codes         | Accept, documented     | Stay on the plugin's sealed storage. Deviation from NIST and ASVS L2 recorded; revisit when Better Auth can hash them                                                              | [N2] [A2]            |
| F7 scrypt cost          | Change (small, optional) | `emailAndPassword.password.{hash,verify}` with OWASP's `N=2^15, r=8, p=3`, versioned prefix, library format still verified                                                       | [O1] [B3]            |
| F8 keyed rate-limit keys | Drop                  | Nothing. Rows live an hour to a day and the same reader holds `user.email`                                                                                                         | —                    |
| F9 EXIF on the server   | Simplify               | One privacy-page sentence: files are stored and sent to the AI provider as uploaded. No server-side parser                                                                         | [A1] 14.2.8 (L3)     |
| F10 least-privilege role | Keep, after launch    | Own PR: a login role with DML only and `BYPASSRLS`; `DATABASE_URL` uses it, `DIRECT_URL` stays the owner                                                                           | [S6] [A3]            |
| Encryption stance       | Keep                   | Provider encryption + grants + retention + backups for business data; seal or hash credentials; env keyring now, KMS envelope with BYOK                                            | [O4] [A1] [A4]       |

## F1 · OAuth tokens

- **No first-class option exists.** The `account` options in 1.7.18 are `encryptOAuthTokens`,
  `updateAccountOnSignIn`, `storeAccountCookie`, `storeStateStrategy`, `skipStateCookieCheck` and `accountLinking`
  (`@better-auth/core/dist/types/init-options.d.mts:1148-1200`; [B1]). None stops the write. A search of `ba/` for
  `storeTokens`, `skipTokenStorage` and similar finds nothing. So the hooks are the right mechanism.
- **Simplify the hook.** Null whichever of the five keys is present in the data, with no `providerId` test:
  credential rows never carry them, and an update's data is partial and often has no `providerId`. Both hooks merge
  their result over the write (`ba/db/with-hooks.mjs:19-22,56-59`).
- **Add `updateAccountOnSignIn: false`** [B1]. With the default, every OAuth sign-in writes the account row
  (`ba/oauth2/link-account.mjs:242-259`); with the hook that write would only store nulls. The update hook is still
  needed for a re-link (`link-account.mjs:78-87`).
- **Use `disabledPaths`** [B1], a documented option answered with 404 before rate limiting or routing
  (`ba/api/index.mjs:168-170`). It covers HTTP requests only; no server code calls these three through `auth.api`.
- **Proved in memory** (1.7.18, memory adapter, both hooks, the three paths disabled): a Google-shaped
  `createAccount` and `updateAccount` stored `null` for every token field; a credential row kept its password;
  `/get-access-token`, the same with a trailing slash, a double slash, upper case and `%2f`, `/refresh-token` and
  `/account-info` answered 404; `/list-accounts` still answered 401 without a session.
- **Nothing breaks.** Linking, sign-in and unlinking match on `providerId` and `accountId` and read no stored token;
  the binding check compares only `accountId`, `providerId` and `userId` (`link-account.mjs:206,264,324`). Our
  last-method guard counts account rows and passkeys (`apps/web/lib/auth-accounts.ts:53-70`). No app code reads the
  columns: outside `packages/db/src/auth-schema.ts` and tests, a search for the token names in `apps/web` and
  `packages` matches only a Paddle error code.
- Keep `encryptOAuthTokens: true` as the guard for a token that slips past a hook after an upgrade, and keep the
  integration test that reads the row back.

## F2 · Data API and grants

Supabase's hardening guide [S4] gives exactly this, and its SQL names three roles, not two:
`alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated,
service_role;`, then the same for sequences and functions.

- **Switch the Data API off** (Integrations, Data API, Enable Data API). "With the Data API disabled, none of the
  auto-generated REST endpoints respond, regardless of grants or RLS" [S4]. `docs/deployment.md:583` says to remove
  `public` from the exposed schemas; the toggle is the stronger and simpler instruction for an app that never uses
  it [S5]. `pg_cron` calling `/api/jobs/drain` is outbound and unaffected.
- **Revoke from `service_role` as well.** It bypasses RLS by design (`docs/architecture/db.md:151`), so today that
  one key reads all 27 tables. The first review revoked only `anon` and `authenticated`.
- **What Supabase re-grants.** New objects in `public` get grants from default privileges [S4]. The migration can
  change the ones `FOR ROLE postgres`, which covers every table Drizzle creates. It cannot change `supabase_admin`'s,
  so a table made in the dashboard's Table Editor may still be granted: schema changes go through migrations only,
  and `rls.int.test.ts` asserts no grants for the three roles (skipped where the roles don't exist).
- Skip the guide's fourth statement (`revoke execute on functions from public`): it reaches other schemas and we
  have no functions in `public`.
- Guard the migration on `pg_roles` so it is a no-op on plain Postgres (database skill rule 1).

## Retention

**Periods.** No standard fixes numbers: GDPR requires a justified period per purpose and that the privacy notice
states "the period for which the personal data will be stored, or if that is not possible, the criteria used to
determine that period" [G1] [G2]. ASVS asks for the schedule to be documented (14.1.2, L2) and for automatic
deletion (14.2.7, L3) [A1]. The proposal is inside common practice: expired credentials within a day; 30 days for
operational records; 90 days for security events; 2 years for the admin audit log (audit practice is commonly at
least one year; stated from experience, not from a fetched source); billing for the life of the workspace, with
Paddle holding the tax records.

**Mechanism.** One daily batched job in the existing queue is the simplest standard approach here. Partitioning
pays off at tens of millions of rows; `pg_cron` deletes would bypass the job record and break the portability rule.

| Table            | Verdict                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verification`   | **Drop from the purge.** Better Auth deletes every expired row on each lookup (`ba/db/internal-adapter.mjs:803`, `disableCleanup` unset)             |
| `rate_limit`     | **Drop from the purge.** Better Auth deletes rows older than its longest window when a window resets (`ba/api/rate-limiter/index.mjs:133,174`); see M1 |
| `session`        | Keep: delete 1 day after `expires_at`. A daily scan of a small table needs no index; measure before adding one                                       |
| `step_up_codes`  | Keep. `step_up_codes_expires_idx` already exists (`apps/web/drizzle/0008_support_retention.sql`)                                                     |
| `step_up_events` | Keep, 90 days. The lockout reads 15 minutes (`packages/core/src/step-up/policy.ts:17`) and the replay check only the current TOTP counter           |
| `jobs`           | Keep, 30 days after `finished_at`, **except `email.welcome` while `user_id` is set**. `jobs_state_finished_idx` already exists                       |
| `invitation`     | Keep, 30 days. Our queries read only `pending` rows (`packages/core/src/admin-queries.ts:520`)                                                       |
| `admin_audit_log` | Keep, 2 years, one statement on `admin_audit_log_created_at_idx`. The planned append-only trigger must allow it                                     |

**Dedupe and idempotency.**

- `enqueueWelcomeEmail` decides "already welcomed" by finding any `email.welcome` job for the user, finished ones
  included (`packages/core/src/jobs/kinds/welcome-email.ts:63-76`). A 30-day purge would welcome a user again when
  they verify an address later. Keep those rows until the account goes (`user_id` is then set null and the row
  purges).
- Resend keeps an idempotency key for 24 hours [R1], and `job:${id}` is only resent while the job is live. Safe.
- Billing dedupes on `billing_events (provider, provider_event_id)` (`packages/db/src/index.ts:657`), not on jobs;
  `billing:event:` keys only dedupe live jobs (`jobs_idempotency_idx`, `index.ts:388`). Safe.
- Admin charts read dead jobs over at most 30 days (`packages/core/src/admin-ops.ts:19,347`). Safe.
- F5: in `reap`, scrub only when the row goes `dead`, not when it is requeued (`queue.ts:313-316`). An admin re-run
  of a scrubbed job must refuse rather than send an empty payload; add that test.

**Privacy page.** "How long we keep it" (`apps/web/app/privacy/page.tsx:114-122`) covers accounts, receipts,
support, billing and usage. Add one sentence each for sign-in records (sessions, security checks), invitations,
background-job records and the admin audit log, in the same PR as the purge.

## F3 · Auth-secret rotation

A re-seal job is what a full key-management system has, but it is not what the standard asks for first. AWS KMS
"retains all key material" after rotation and "does not … re-encrypt any data" [K1]; OWASP says to keep retired
keys while data needs them and to rotate on compromise or at the cryptoperiod [O4]; Better Auth documents rotation
as non-destructive with lazy re-encryption [B3]. `docs/deployment.md:393-398` already says to keep every version
while a `two_factor` row uses it and gives the count query. Re-sealing also does nothing for a dump taken before the
rotation: if a secret and the database both leak, the TOTP seeds are burned and users re-enrol. Build the re-seal
once, inside BYOK's rewrap job (BYOK plan §9.3), when there is a second keyring to justify the registry.

## F6 to F10

- **F6.** NIST SP 800-63B-4 §3.1.2.2 and ASVS 6.5.2 (L2) want look-up secrets under 112 bits salted and hashed
  [N2] [A2]. The plugin cannot: it compares the input with the decrypted list
  (`ba/plugins/two-factor/backup-codes/index.mjs:33-41`). Owning backup codes ourselves is more risk than the gap.
  Accept and record.
- **F7.** Better Auth's scrypt is `N=2^14, r=16, p=1` (`@better-auth/utils/dist/password.node.mjs:4-8`), a work
  factor of 2^18 against 2^19.3 to 2^20 for OWASP's five listed rows [O1]. The override is supported
  (`ba/context/create-context.mjs:183-184`). Local timing, one hash, Codespace CPU: today 262 ms at 32 MiB;
  `N=2^15, r=8, p=3` 440 ms at 32 MiB; `N=2^16, r=8, p=2` 642 ms at 64 MiB; `N=2^17, r=8, p=1` 841 ms at 128 MiB.
  Recommended: the 32 MiB row (no extra memory per concurrent sign-in), stored with a version prefix, falling back
  to the library's verify for unprefixed hashes. Before launch there are no real hashes to upgrade, so no
  rehash-on-sign-in code; if this lands after launch, add it in the existing `/sign-in/email` after-hook [O1].
- **F8.** Drop. The rows live an hour (M1) to a day, and anyone who can read `rate_limit` can read `user.email`.
- **F9.** ASVS 14.2.8 is L3 [A1]. The browser already re-encodes most uploads. A server-side JPEG/PNG/WebP segment
  parser is new attack surface for little gain; say in the privacy policy that files are kept, and sent to the AI
  provider, as uploaded.
- **F10.** Supabase recommends a role per service [S6] and ASVS 13.2.2 (L2) asks for least privilege [A3]. It is
  not a one-liner here: RLS is on with no policies, so a non-owner role reads nothing unless it has `BYPASSRLS` (or
  27 policies); the password is a per-environment secret created outside migrations; the compose stack needs the
  same role. It stops DDL and reads of other schemas, not reads of our tables. After launch, own PR.

## Encryption stance

Defensible, and it matches what comparable products publish: Dext states TLS 1.2+ and "AES-256 encryption, applied
at the asset or object level" with ISO 27001 [C3]; Expensify states HTTPS and TLS with SOC 1 and SOC 2 Type 2 and
PCI DSS [C4]. Neither claims field-level encryption of expense data.

- **ASVS 5.0.** L1 has no encryption-at-rest requirement. L2 asks for a classification (14.1.1), a documented
  protection level per class covering encryption, retention and logging (14.1.2), and that it is implemented
  (14.2.4) [A1]; a key policy and inventory (11.1.1, 11.1.2), authenticated ciphers (11.3.3), a tuned password KDF
  (11.4.2) [A4]; a secrets store (13.3.1) [A3]. The architecture page is that documentation.
- **When field encryption is warranted** [O4]: the value is a secret the app must replay, nothing queries it, and
  it is worth more than its row. Here: TOTP seeds and backup codes (sealed), future BYOK provider keys (envelope,
  AAD-bound), and nothing else. Verifiers are hashed (passwords, verification tokens, step-up codes). Receipts,
  line items and support text are queried, aggregated and searched; encrypting them protects against a database
  reader who lacks the app's environment, which grants, retention and encrypted backups already address. If we ever
  held bank account numbers, card numbers or government ids, the answer would be not to store them.
- **Key in env against KMS.** OWASP prefers a vault and separation of keys from data, and notes envelope encryption
  has "limited value" in simple setups [O4]. Vercel Secret variables are write-only after saving [V1] and live
  apart from the database, which is the separation that matters. A KMS-held KEK is right once `DATA_ENCRYPTION_KEYS`
  exists; adding one for two sealed columns is not.
- **Rotation norm.** On compromise or staff change, otherwise about yearly (the AWS KMS default is 365 days [K1];
  NIST SP 800-57 Part 1 §5.3 sets cryptoperiods by key type [N3]). Old versions stay for decryption.
- **An auditor (SOC 2 CC6, ISO 27001 A.8.24 and A.8.10) would ask for:** the classification and key inventory; the
  rotation runbook and a dated record of the last rotation; encrypted backups and a restore test; who can open the
  Supabase, Vercel and Cloudflare consoles, with MFA; the retention schedule and proof the purge runs; verified TLS
  to the database; the sub-processor list. The open ones are backups (STATUS D1), console MFA (roadmap 12) and M2.
  SOC 2 and ISO texts were not fetched; these are the usual evidence requests, not quotations.

## Missed by the first review

- **M1. Better Auth's prune probably resets our 24-hour limits after an hour.** `hitRateLimit` stores our counters
  in Better Auth's `rate_limit` table (`packages/core/src/workspace.ts:84-104`). When any Better Auth window resets,
  1.7.18 deletes every row with `last_request` older than its longest configured window
  (`ba/api/rate-limiter/index.mjs:82,133,174-183`), which is one hour (`apps/web/lib/auth-rate-limit.ts:10-17`).
  Our contact-reply cap (one per address per 24 hours, `apps/web/lib/email-limits.ts:59`) and the support cap (10
  per user per 24 hours, `packages/core/src/support.ts:34`) would then last about an hour. Read from source, not
  exercised: write the integration test first. If confirmed, give our limiter its own table with the same shape
  (one small migration, purged by `maintenance.purge`) rather than a dummy 24-hour rule in Better Auth's config.
- **M2. Postgres TLS.** Supabase does not enforce SSL by default [S7]. The pool verifies the server only when
  `DATABASE_SSL_CA` is set; otherwise the URL's `sslmode` decides (`packages/db/src/index.ts:901-910`). Confirm
  `DATABASE_SSL_CA` is set on `staging-db` and `production-db` and turn on Enforce SSL. Not checked here.
- **M3 to M6.** `service_role` (F2); the welcome-email dedupe (Retention); migration `0009` as proposed duplicates
  `step_up_codes_expires_idx` and `jobs_state_finished_idx`; uploads reach the AI provider with their metadata, not
  only R2 (F9).

## Build order

| PR  | Contents                                                                                                                                            | Migration                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | F1: hooks, `updateAccountOnSignIn: false`, `disabledPaths`, null existing tokens, tests                                                             | `0009`, data only                            |
| 2   | F2: guarded revoke and default privileges, grant assertion in `rls.int.test.ts`; owner switches the Data API off and Enforce SSL on (M2)            | `0010`, grants; plus two dashboard settings  |
| 3   | F4 + F5: purge sessions, step-up rows, jobs (keeping welcome rows), invitations, audit log; scrub on reap and cancel; privacy page (with F9's line) | None                                         |
| 4   | M1: integration test; if it fails, our own rate-limit table                                                                                         | Only if confirmed                            |
| 5   | F7, if the owner says yes                                                                                                                           | None                                         |
| —   | F10 after launch; F3 with BYOK; F6 and F8 not built                                                                                                 |                                              |

## Sources

All checked 2026-11-14. Better Auth source lines are from 1.7.18 as installed.

- [B1] Better Auth options (`disabledPaths`, `account.*`, `databaseHooks`): <https://www.better-auth.com/docs/reference/options>
- [B3] Better Auth security reference (secret rotation, custom password hash): <https://www.better-auth.com/docs/reference/security>
- [S4] Supabase, Hardening the Data API: <https://supabase.com/docs/guides/database/hardening-data-api>
- [S5] Supabase, Securing your API: <https://supabase.com/docs/guides/api/securing-your-api>
- [S6] Supabase, Postgres roles: <https://supabase.com/docs/guides/database/postgres/roles>
- [S7] Supabase, Platform security (TLS; Postgres SSL not enforced by default): <https://supabase.com/docs/guides/security/platform-security>
- [O1] OWASP Password Storage Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- [O4] OWASP Cryptographic Storage Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html>
- [A1] OWASP ASVS 5.0.0, V14 Data Protection: <https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x23-V14-Data-Protection.md>
- [A2] ASVS 5.0.0, V6 Authentication (6.5.2): <https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md>
- [A3] ASVS 5.0.0, V13 Configuration (13.2.2, 13.3.1): <https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x22-V13-Configuration.md>
- [A4] ASVS 5.0.0, V11 Cryptography: <https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x20-V11-Cryptography.md>
- [N2] NIST SP 800-63B-4 §3.1.1.2, §3.1.2.2, §3.1.4.2: <https://pages.nist.gov/800-63-4/sp800-63b.html>
- [N3] NIST SP 800-57 Part 1 Rev. 5 (abstract page fetched; §5.3 cited through [O4]): <https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final>
- [K1] AWS KMS, Rotate keys: <https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html>
- [G1] GDPR Article 13(2)(a): <https://gdpr-info.eu/art-13-gdpr/>
- [G2] ICO, Storage limitation: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/>
- [R1] Resend, Idempotency keys (kept 24 hours): <https://resend.com/docs/dashboard/emails/idempotency-keys>
- [V1] Vercel, Config and Secret environment variables: <https://vercel.com/docs/environment-variables/sensitive-environment-variables>
- [C3] Dext, Security: <https://dext.com/en/security>
- [C4] Expensify, Encryption and Data Security (read through search results, not fetched in full): <https://help.expensify.com/articles/new-expensify/settings/Security>
