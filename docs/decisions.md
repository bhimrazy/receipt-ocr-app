# Decisions and things to watch

The owner's standing decisions, and what has to happen later because of them. Open questions stay in
[STATUS](STATUS.md#decisions-waiting-on-the-owner); once one is decided, record it here with the date and the reason.

## Decided

| Date       | Decision                                                                                                                                                                                 | Why / where                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-11-08 | Until launch, staging and production data are disposable: either database may be reset and the baseline re-applied, more than once if needed.                                            | Pre-launch; no customer data yet. A reset still needs the owner's go each time.                                 |
| 2026-11-08 | The lab landing variants (`app/(lab)`) are deleted; Classic stays the homepage.                                                                                                          | Architecture review: ~12.6k unused lines.                                                                       |
| 2026-11-08 | Production auth secret replaced outright with 32 random bytes (pre-launch reset, no versioned list); a current secret under 32 characters now stops the app from starting in production. | Security review M2. [Rotating the auth secret](deployment.md#rotating-the-auth-secret)                          |
| 2026-11-07 | BYOK: Free 2 / Pro 3 keys per workspace; turning BYOK off routes to the platform chain (counted, with a banner and an email); own-key scans Free 50 / Pro 2,000 a day.                   | [BYOK plan §11](plans/2026-11-07-byok.md). The admin key store comes first, then workspace BYOK. Not built yet. |
| 2026-11-08 | Groq is the last fallback in the platform chain (Qwen 3.8 27B), and also usable with workspace keys.                                                                                     | Owner decision. Needs Groq zero data retention on the org first; it is still a preview model.                   |
| 2026-11-08 | Default OCR chain: Claude Haiku 5.5, then Gemini 3.5 Flash-Lite, then Qwen 3.8 27B on Groq; `GEMINI_MODEL` removed.                                                                      | Owner decision, replacing #93 (Sonnet first). Benchmark: same accuracy as Sonnet at about a tenth of the cost.  |
| 2026-11-07 | iOS splash: dark, iPhone, portrait only (10 images).                                                                                                                                     | A light set follows the Light/System/Dark theme work.                                                           |
| 2026-11-07 | Brand: Scan line mark, spelled "ReceiptOCR", "scanned" in copy.                                                                                                                          | [Brand decisions](STATUS.md#brand-decisions-owner-2026-11-07)                                                   |

## Things to take care of later

### On a date

- **After 2026-11-12 15:00 UTC:** delete `minimumReleaseAgeExcludes` from `bunfig.toml` (the Better Auth 1.7.18
  cooldown exception).

### When something ships

- **Two-step sign-in (#95):** `BETTER_AUTH_SECRETS=1:<current secret>` was set in production on 2026-11-08, before it shipped, so sealed rows carry a version. From then on, TOTP secrets and backup codes are sealed with the auth secret. Never drop a
  secret version while rows sealed under it exist. A rotation then needs the current value, so keep it in a password
  manager: Vercel Sensitive variables can't be read back.
- **Effort `xhigh`/`max`:** stay hidden until an OCR call may run longer than 50 s (a worker app or a longer function
  limit).
- **Groq or OpenAI key in production:** turn on Groq zero data retention first. OpenAI keeps requests up to 30 days,
  and the privacy policy says so.

### Before launch (real user data)

- Stop resetting databases, and turn on backups with a restore drill (nightly `pg_dump` to R2, or Supabase Pro with
  point-in-time recovery).
- Make the schema fixes that are cheap only while data is disposable: `receipts.receipt_date` from text to `date`,
  plus the rest of the [database review](reviews/2026-11-07-full-database.md).
- Retention: purge job and privacy-page wording for sessions, logs, job rows and the usage ledger.
- Supabase: confirm RLS is on and remove `public` from the Data API's exposed schemas.
- Turn the CSP from report-only to enforced.

### Before the first paid customer

- Vercel Hobby is non-commercial: move to Vercel Pro or the Docker deploy first.
- Payments (Paddle), a published price and a refunds page ([payments plan](plans/2026-11-07-payments.md)).

### Before adding outside collaborators

- Split the Vercel deploy token: a separate preview project with its own token, so PR builds can't reach production.
