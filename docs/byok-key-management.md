# BYOK Key Management — Security Design

_Status: design (not yet implemented) · July 2026_

How ReceiptOCR will store and use user-provided credentials — AI provider API keys (Gemini,
later others) and S3-compatible storage credentials (endpoint, bucket, access key, secret) —
without ever becoming the weak link. These are bearer credentials: anyone holding them can
spend the user's money and read their bucket. Treat them like passwords, not like settings.

## 1. Principles

1. **Server-side only, always.** Keys are submitted once over TLS, encrypted immediately, and
   never returned to any client — not in API responses, not in server-rendered props, not in
   logs. The UI only ever sees metadata: provider, a label, `last4`, created/last-used dates,
   and validation status.
2. **Encrypted at rest with envelope encryption.** Never store plaintext or merely-hashed
   secrets (they must be recoverable to use, so hashing is out; plaintext is negligence).
3. **Least privilege + isolation.** One user's keys are only decryptable in the context of a
   request for that user. Every decrypt is tied to a `userId` check at the repository layer,
   same as receipts.
4. **Auditable.** Creating, rotating, deleting, and _using_ a key each add fields to the
   request's wide event (`key_id`, `key_source: "byok" | "managed"`) — never the material.
5. **Fail closed.** If decryption or validation fails, fall back to _nothing_ (surface the
   error), never to another user's or the platform's keys silently.

## 2. Storage design (envelope encryption)

```
user submits key ──TLS──▶ API route (Clerk-authed)
                             │ validate shape + live-test the credential
                             ▼
                        DEK = random 256-bit key            (per secret)
                        ciphertext = AES-256-GCM(DEK, secret, aad)
                        wrappedDEK = KMS.Encrypt(DEK)        (KEK in KMS)
                             ▼
                        db: user_credentials row (no plaintext anywhere)
```

- **Cipher:** AES-256-GCM with a random 12-byte nonce per encryption; store nonce + auth tag
  alongside ciphertext.
- **AAD (additional authenticated data):** `userId:credentialId:type`. A ciphertext copied to
  another row/user fails authentication — this is what makes cross-tenant confusion
  cryptographically impossible, not just checked-in-code.
- **KEK (key-encryption key):** lives in a KMS/secret manager, never in the database or env
  of the app runtime if avoidable. Options, best-first:
  1. Cloud KMS (AWS KMS / GCP KMS / Cloudflare) — HSM-backed, rotation and audit built in.
  2. A libsodium sealed-box master key held only in the deployment platform's encrypted env
     (acceptable for early access; document the upgrade path).
- **Key rotation:** rotating the KEK re-wraps DEKs (cheap, no secret re-entry). Users can
  rotate their own credentials any time; keep the old row `revoked_at`-stamped rather than
  hard-deleted for 30 days of audit, then purge.

### Schema sketch

```ts
export const userCredentials = pgTable("user_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(), // "gemini" | "s3"
  label: text("label"),
  last4: text("last4").notNull(), // display only
  ciphertext: text("ciphertext").notNull(), // base64(nonce ‖ ct ‖ tag)
  wrappedDek: text("wrapped_dek").notNull(),
  kekVersion: integer("kek_version").notNull().default(1),
  status: text("status").notNull().default("active"), // active | invalid | revoked
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
```

For S3 credentials, encrypt the whole config object (endpoint, region, bucket, accessKeyId,
secretAccessKey) as one JSON blob — partial plaintext (e.g. bucket name in a plain column) is
fine for display, but the secret never is.

## 3. Runtime use (Effect integration)

Add a `CredentialsService` to `@receipt-ocr/core`:

```ts
type CredentialsServiceShape = {
  /** Decrypts and returns config for this user, or falls back to platform config. */
  resolveAiConfig(userId: string): Effect.Effect<AiConfig, CredentialError>;
  resolveStorageConfig(userId: string): Effect.Effect<S3StorageConfig, CredentialError>;
};
```

- `ReceiptProcessingLive` asks `CredentialsService` per request instead of reading the static
  `ConfigService` directly; the service returns `{ config, source: "byok" | "managed" }` so the
  wide event can record which path ran.
- Decrypted material lives only in function scope for the duration of the request — never
  cached in module state, never attached to the Effect context longer than needed.
- On provider auth failure (401 from Gemini / S3), mark the credential `invalid`, surface a
  clear "your key stopped working" state in settings, and do not silently fall back to
  platform keys (that would turn a user misconfiguration into our bill).

## 4. API surface

| Route                                         | Behavior                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/settings/credentials`              | Validate shape → live-test (1 cheap call: Gemini `models.list`; S3 `HeadBucket`) → encrypt → store. Returns metadata only. |
| `GET /api/settings/credentials`               | List metadata (type, label, last4, status, dates). Never material.                                                         |
| `DELETE /api/settings/credentials/:id`        | Mark revoked; stop using immediately.                                                                                      |
| `POST /api/settings/credentials/:id/validate` | Re-run the live test on demand.                                                                                            |

All behind Clerk auth + the existing proxy matcher; add per-user rate limiting on create/validate
(these hit external providers).

## 5. Logging & telemetry rules (ties into `lib/log.ts`)

- Wide events may include: `credential_id`, `key_source`, `provider`, `validation_outcome`.
- Wide events must never include: key material, full bucket URLs with embedded credentials,
  decrypted config objects. Add a `redact()` helper and a lint-grep in CI for obvious
  accidents (`accessKeyId`, `apiKey` appearing in `logger.` call sites).
- Error paths are the classic leak vector: never log raw provider errors from credential
  calls without passing through redaction (SDK errors sometimes echo the request).

## 6. Threat checklist

| Threat                             | Mitigation                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| DB dump stolen                     | Ciphertext useless without KMS KEK; AAD binds rows to users                                                     |
| App-server env leaked              | KEK not in app env (KMS); managed platform keys still exposed — rotate those                                    |
| Cross-tenant bug in code           | AAD makes wrong-user decryption fail closed                                                                     |
| Key echoed to browser              | UI contract is metadata-only; code review + tests assert response shape                                         |
| Keys in logs                       | Wide-event allowlist + redaction helper + CI grep                                                               |
| Malicious S3 endpoint (SSRF)       | Validate endpoint URL: https-only, deny private IP ranges/link-local, resolve-and-check                         |
| User's key abused after our breach | Document scoping guidance in UI: recommend key restricted to Generative Language API / bucket-scoped IAM policy |
| Stale invalid keys burning retries | `status: invalid` short-circuits with a settings prompt                                                         |

## 7. Implementation order

1. Schema + crypto helpers (`packages/core`: `encryptSecret`/`decryptSecret` with AAD; KEK via
   env-held master key first, KMS interface behind it).
2. `CredentialsService` + repository, wired into `ReceiptProcessingLive` with `key_source`
   surfaced in wide events.
3. Settings UI (add/list/revoke/validate; metadata only).
4. Redaction helper + CI grep.
5. Docs page for users: how to create a scoped Gemini key and a bucket-scoped R2/S3 token —
   this doubles as trust-building marketing content.
6. Later: move KEK to cloud KMS, add re-wrap migration (`kekVersion` already in schema).
