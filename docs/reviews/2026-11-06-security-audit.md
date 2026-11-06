# Security audit — 2026-11-06

## Security review — Changes requested

Scope: `main` at `5e2b4c6` (clean tree), read-only. This builds on
[2026-11-04-security.md](../../docs/reviews/2026-11-04-security.md) and
[2026-11-06-security-plan.md](../../docs/reviews/2026-11-06-security-plan.md) and re-reports nothing they cover that is
now fixed. Better Auth 1.7.14 was read from `node_modules/.bun/better-auth@1.7.14…/dist`. Advisory text comes from
`gh api /repos/better-auth/better-auth/security-advisories`.

How it was tested:

- Probes ran in a scratch Vitest harness (outside the repo) against the real `apps/web/lib/auth.ts`. They used a
  throwaway database `sec_audit_20261106` on the local compose Postgres, migrated with `bun run db:migrate`, with dummy
  users only. The database has been dropped.
- During the run, another process recreated the compose stack, which moved Postgres from 5433 to 5461. The database
  survived on the volume. I did not touch that stack.
- The existing integration suites (`receipts.int`, `admin.int`, `auth.int`, 36 tests) pass against the same database.
- I ran `bun run check:deps` and `bun audit`.

Profile: a single standard pass by one reviewer. The skill's `findings.json` and ledger artifacts were not produced,
because the caller asked for this one report. Coverage is the list in "Verified secure" plus the findings. Nothing here
claims that the rest is exhausted.

## Better Auth 1.7.16 advisories: which apply to this config

| Advisory                             | Exploitable here?                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Mitigation before upgrading                    |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| GHSA-c85h (padded owner role)        | **Yes, reproduced** (M1)                     | The default org roles let `admin` invite. The `"admin, owner"` value passes the creator check at `crud-invites.mjs:125`.                                                                                                                                                                                                                                                                                                                                                   | Yes: role allowlist in `beforeCreateInvitation` |
| GHSA-fvxx (revoked sessions + cache) | Advisory paths: no. Residual: **yes** (M2)   | No `secondaryStorage`, passkey, device auth or 2FA. `link-social` needs the same email (`account.mjs:211`), so it can't be used to persist. But with `cookieCache` on, every Better Auth endpoint still accepts a revoked session for 5 min. That window is enough to plant a lasting invitation (reproduced).                                                                                                                                                             | Yes: `cookieCache.enabled: false`              |
| GHSA-9hm7 (OAuth unverified email)   | No                                           | Google's `email_verified` comes from the ID token as a boolean (`google.mjs:132`). GitHub's comes from `/user/emails` `verified`, a boolean (`github.mjs:76`). No `genericOAuth`, no Zoom, no `trustedProviders`.                                                                                                                                                                                                                                                          | Not needed                                     |
| GHSA-hwq2 (email-change links)       | No                                           | `user.changeEmail` is not enabled (none in `lib/auth.ts`, no `changeEmail` call anywhere in the app).                                                                                                                                                                                                                                                                                                                                                                      | Not needed                                     |
| Others (4wq4, 48c2, q747, g95c, 2f9c, gv75, x8j7, 9p5w) | No                        | Expo, MySQL serial ids, phone number, email OTP, passkey, Stripe and Electron are all unused, and `trustedOrigins` has no wildcard.                                                                                                                                                                                                                                                                                                                                        | —                                              |

Recommendation: ship both workarounds (M1, M2) now. They are small config and hook changes with no new dependency.
Upgrade to 1.7.16 when it clears the cooldown on 2026-11-10. M1 is a confirmed, exploitable privilege escalation, so a
one-time cooldown exemption would also be defensible. The global policy already allows security fixes.

## Blocking

None. Nothing found here is reachable without an existing account in the right position. M1 and M2 should still land
before more workspaces are shared.

## Medium

### M1 · A workspace admin can make an account they control an owner, then remove the real owner (GHSA-c85h)

- **Where:**
  - `apps/web/lib/auth.ts:235`: `beforeCreateInvitation` only rate-limits and never looks at `invitation.role`.
  - Better Auth `plugins/organization/routes/crud-invites.mjs:102-125`: role validation trims each part, but the creator
    check is `roles.split(",").includes("owner")` on the raw string. The raw string is stored at `:203`.
  - `permission.mjs:4` splits without trimming, and `crud-invites.mjs:125` trims the inviter's role.
- **Scenario:**
  1. Owner O promotes A to `admin`, which the members page offers. A invites their second (verified) account B with
     `role: "admin, owner"` (or `["admin", " owner"]`). B accepts.
  2. B has admin permissions, and Better Auth's inviter check treats B as an owner, so B invites C with `role: "owner"`.
  3. C is a real owner and can demote and remove O, delete the workspace (purging its receipt files) or export
     everything.
  4. In our UI, `toRole("admin, owner")` (`components/members/roles.ts:28-30`, used at `settings/members/page.tsx:35,41`)
     shows both B and the pending invite as **Member**. O sees nothing unusual. Meanwhile `canManageAnyReceipt`
     (`core/src/repository.ts:51-52`) trims, so B already manages every receipt.
- **Reproduction (done, local):**
  - `createInvitation(A → B, "owner")` returns `403 YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE`.
  - `createInvitation(A → B, "admin, owner")` returns 200 with stored role `"admin, owner"`. After accept, the members
    table reads `[["O","owner"],["A","admin"],["B","admin, owner"],["C","owner"]]` once B has invited C.
  - `updateMemberRole(O → member)` and `removeMember(O)` both succeed as C. O ends with 0 memberships.
- **Fix (works on 1.7.14):** in `organizationHooks.beforeCreateInvitation`, reject any role that isn't exactly one of
  the three single roles before rate-limiting:

  ```ts
  beforeCreateInvitation: async ({ invitation, inviter }) => {
    if (!["member", "admin", "owner"].includes(invitation.role)) {
      throw new APIError("BAD_REQUEST", { message: "Invalid role" });
    }
    await limitInvitations(inviter.id);
  },
  ```

  Also:
  - Add an `auth.int` test that `"admin, owner"`, `" owner"` and `["admin"," owner"]` from an admin all get 400.
  - Audit existing data, without trimming in place:
    `select id, organization_id, role from member where role !~ '^(member|admin|owner)$'`, and the same query against
    `invitation where status = 'pending'`. Review any owners those members invited.
  - Make `toRole` fail loudly (render the raw value or "Unknown"), not silently as "Member".
  - Keep the check after the 1.7.16 upgrade. It is the app's own invariant, and `organizationLimit` (`auth.ts:250`) and
    the sole-owner rule in `prepareUserDeletion` both compare `role = 'owner'` exactly.

### M2 · A revoked or banned session keeps Better Auth API access for 5 minutes and can leave a permanent foothold

- **Where:**
  - `apps/web/lib/auth.ts:155-158` (`cookieCache` on, 5 min).
  - Better Auth `api/routes/session.mjs:48,293`: `sessionMiddleware` uses the cache, and every `/organization/*`,
    `/update-user`, `/delete-user` and admin-plugin route depends on it (`plugins/organization/call.mjs:10`).
  - The app's own reads do skip the cache (`lib/session.ts:18-20`), so `/api/receipts*` and pages are correct. The
    comments at `lib/session.ts:18` and `app/admin/actions.ts:231` ("applies at once") don't hold for `/api/auth/*`.
- **Scenario:** an attacker has stolen a session (both `better-auth.session_token` and `better-auth.session_data`
  cookies). The victim resets their password (`revokeSessionsOnPasswordReset`), or an admin bans them or revokes their
  sessions. For up to 5 minutes the attacker can still call `POST /api/auth/organization/invite-member` with
  `role: "owner"` to their own address. Accepting that invite gives a new, legitimate session and a membership that
  outlives every revocation. The same window allows `update-user`, org deletion and member removal.
- **Reproduction (done, local):**
  - Delete every `session` row for user V, which is what `revokeUserSessions` and the ban do.
  - `getSession({ disableCookieCache: true })` returns `null`, but `getSession()` with the same cookies still returns
    the session.
  - `createInvitation(V → attacker, "owner")` returns **200**.
- **Fix:** set `session.cookieCache.enabled: false`. Every server read already bypasses it, so the only cost is one
  indexed session lookup on `/api/auth/get-session` and other auth-endpoint calls. Fix the two comments to match. If the
  cache is ever wanted back, pin a test that a revoked session gets 401 from `invite-member`.

### M3 · Preview deploys: PR code in `vercel build` can capture `VERCEL_TOKEN` from the next step

- **Where:** `.github/workflows/preview.yml:33-36,44-50`. The CLI is installed into the workspace
  (`.github/vercel-cli/node_modules/.bin`, which goes on `PATH`). `vercel build` then runs the PR's code with no token,
  as the 2026-11-04 M5 fix intended. The next step runs that same `vercel` binary with `VERCEL_TOKEN` in its env. The
  production job (`production.yml:25`) uses the same `vercel` environment, so presumably the same token.
- **Scenario:**
  1. A same-repo PR runs code during `next build`. That could be a collaborator, a compromised or prompt-injected agent
     pushing a branch, or a dependency bump whose code runs at build time.
  2. The code rewrites `.github/vercel-cli/node_modules/.bin/vercel` (or `vercel/dist/*.js`), or drops a file the CLI
     loads. It can also edit the already-downloaded `peter-evans/*` actions under the runner's `_actions` directory.
  3. The deploy step then runs the attacker's code with the token, which can deploy to production. The comment steps
     run with a `pull-requests: write` `GITHUB_TOKEN`.
  4. Separately, `vercel pull` has already written the Preview env (`.vercel/.env.preview.local`) where the PR code can
     read it.

  Fork PRs get no secrets, and Dependabot is skipped. Both are correct.
- **Reproduction:** by reading the workflow. Steps of one job share the filesystem, and the token-bearing step executes
  files the token-less step could write. Not run, since that would mean pushing a branch.
- **Fix:**
  - Split the work into two jobs:
    1. `build` (no secrets except the pull, which is the same problem, so build with only non-secret Preview vars).
    2. `deploy`, which runs only `vercel deploy --prebuilt` on the uploaded `.vercel/output` artifact, with a CLI
       installed fresh in that job, outside the workspace (`bun add -g` to a temp prefix).
  - Use a separate `vercel-preview` environment holding a token that can't promote to production (or Vercel's Git
    integration for previews). Restrict the `vercel` environment to `main` (deployment branch policy).
  - Needs validation (owner, Vercel dashboard): which secrets the Preview environment holds. If `DATABASE_URL`,
    `BETTER_AUTH_SECRET` or the paid Gemini key are shared with Production, any same-repo PR can read production data
    and forge sessions, regardless of the token. Preview should have its own DB, secret and a capped AI key, with Vercel
    Deployment Protection on.

## Low

| #   | Where | Issue · scenario | Fix |
| --- | ----- | ---------------- | --- |
| L1  | `app/api/receipts/route.ts:46-48`, `lib/http.ts:170-196` | The body starts streaming into memory before the session check, and keeps streaming after an early 401/409, since nothing cancels it. On Docker (no platform body cap), an unauthenticated client can make the server buffer about 10 MB per concurrent request. Bounded per request, unbounded in concurrency. | Await `getSession()` first, or `request.body?.cancel()` on the early-return paths. Put a body limit on the reverse proxy in front of the image (note it in `docs/deployment.md`). |
| L2  | `packages/core/src/files.ts:31`, `pipeline.ts:188` | PDFs have no page cap (plan M6 is still open). A 4 MB (Vercel) or 10 MB (Docker) text PDF can be hundreds of pages, so one call costs on the order of 100k+ input tokens, times the fallback chain, within each user's 20 a day. `maxOutputTokens` and schema `.max()` are in place. | Count `/Type /Page` objects (or reject `/Count` > 10) in `validateUpload` before storing. Add a unit test with a 50-page fixture. |
| L3  | `apps/web/next.config.ts:4-17,27` | The CSP is report-only with no `report-uri`/`report-to`, so the stated plan of enforcing it "until it has run clean" can never produce evidence. `script-src 'unsafe-inline'` is in the draft. The enforced headers (XFO DENY, nosniff, referrer, HSTS) are good. | Add a `report-to` endpoint (or `/api/csp-report` that logs counts), then move to nonces through `proxy.ts` and enforce. |
| L4  | `package.json` `audit` script, CI `static` job | `bun audit` is blind to Better Auth's advisories. They are repo-level GHSAs that never reached the global database (`gh api /advisories/GHSA-9hm7…` returns 404). Locally `bun audit` reports only esbuild and minimatch dev issues, while better-auth 1.7.14 is listed as vulnerable in 12 repo advisories, one rated critical. CI's audit gate gave no signal. | Subscribe to `better-auth/better-auth` security advisories (Watch → Security), or add a scheduled job that diffs `gh api repos/better-auth/better-auth/security-advisories` against the pinned version. |
| L5  | `.github/workflows/production.yml:10,35` | `workflow_dispatch` deploys `github.sha` of whatever branch it's run on, to production, skipping CI. Anyone with write access can ship an unreviewed branch. | Deployment branch policy `main` on the `vercel` environment (also closes part of M3), or `if: github.ref == 'refs/heads/main'`. |
| L6  | `docker-compose.yml:24` | Postgres is published on `0.0.0.0` with `postgres/postgres`, unlike RustFS (`127.0.0.1`). On shared Wi-Fi, anyone on the LAN can read the local DB and any real data copied into it. | `"127.0.0.1:${POSTGRES_PORT:-5433}:5432"`. |

## Informational

- **Any member can retry any failed receipt in the workspace.** `claimRetry` uses `inScope`, not `writable`
  (`repository.ts:451`). The retrier's own quota pays, so this is a policy question, not a leak.
- **Per-user quota resets with the account.** `ocr_rounds.user_id` is `SET NULL` on delete, and `deleteUser` is
  enabled, so delete, re-sign-up and repeat gives a fresh 20 a day. That is no worse than plus-addressing, but it means
  `OCR_DAILY_CAP` (unset by default, `core/src/config.ts:40`) is the only real spend ceiling. Set it before launch, as
  STATUS already says.
- `rateLimit.customRules` still has no per-email limit on `/request-password-reset` or `/send-verification-email`.
  Better Auth's built-in 3 per 10 s per IP applies (probed on 2026-11-04). Someone with many IPs can still mail-bomb
  one address (plan L2).

## Verified secure

- **Workspace isolation is structural and pinned:**
  - Every receipt query goes through `inScope`/`writable`/`filterWhere` on `organization_id`
    (`repository.ts:173-206`).
  - The scope comes from `member` on every request (`core/src/workspace.ts:14-28`; the earlier B1 is fixed).
  - Pinned by `receipts.int` "workspace isolation …", "B1 …" and "P2-5 …". All of them pass on this run.
- **The usage ledger and quota (migration 0007) hold:**
  - The ledger is append-only (`ocr_rounds`/`ocr_calls`).
  - Its FKs are `ON DELETE SET NULL`, so deleting a receipt or workspace gives nothing back.
  - The round is reserved at ingest or retry claim under `pg_advisory_xact_lock(7301, hashtext(user_id))`
    (`usage.ts:91`, `repository.ts:348,436`).
  - The `status` column has a CHECK enum and no free text.
  - Pinned by "P0-1", "B4: deleting the workspace …" and "B4: a parallel burst …". All pass.
- **The upload pipeline:**
  - The type is sniffed from magic bytes, and the client type is ignored (`files.ts:21-33`).
  - Size is capped on `Content-Length` and while streaming (`http.ts:170-196`).
  - The object key is `users/<id>/receipts/<uuid>.<ext-from-sniffed-type>`, with no client name (`storage/src/index.ts:52`).
  - Nothing decodes images or PDFs server-side, so there is no decompression-bomb surface.
  - HEIC is passed through.
- **Presigned URLs:**
  - 10-minute lifetime (`storage/src/index.ts:106`), signed only after a scoped DB read.
  - The response type is pinned from the extension. PDFs are served `attachment`, so an SVG or HTML payload can't render
    on the bucket origin.
- **CSRF and Origin:**
  - Every mutating `/api/receipts*` and `/api/contact` requires `Origin === BETTER_AUTH_URL` origin, and a missing
    Origin is refused (`http.ts:129-132`).
  - Better Auth's own origin check runs with `trustedOrigins` set to the app URL only.
  - Cookies are HttpOnly and `SameSite=Lax`, with `Secure` from the https base URL.
- **Admin and impersonation:**
  - Every admin page and server action calls `requireAdmin()` itself.
  - Session tokens never reach the browser (`admin/users/[id]/page.tsx` maps to id, IP and UA only; the revoke action
    resolves the token server-side).
  - Admins can't be banned, deleted or impersonated (`actions.ts:151`).
  - Impersonation start and stop are audited with the reason.
- **Email ownership before access:**
  - `requireEmailVerification` defaults to true in production (`env.ts:16-19`).
  - `ADMIN_EMAILS` promotion only happens on a verified address (`auth.ts:64-74`; the earlier B2 is fixed).
  - `requireEmailVerificationOnInvitation: true` is set.
  - Implicit OAuth linking needs both sides verified (Better Auth `requireLocalEmailVerified` default).
- **Open redirect fixed:** `safeRedirect` resolves against a probe origin and rejects control characters and `\`
  (`lib/redirect.ts:15-31`). This fixes the earlier M1.
- **Mail and log hygiene:**
  - In production an undelivered mail fails the request, not the log body (`auth.ts:53-58`), and `logUndelivered`
    only applies in development (fixes the earlier M3).
  - The contact route logs only the topic and length.
  - Contact `replyTo` can't inject headers (the email regex excludes whitespace).
- **CSV injection:** the guard sits at the single `cell()` choke point, with plain numbers exempt (`lib/csv.ts:11-17`).
  It is shared by the export route and the client-side item export.
- **Secrets stay server-side:**
  - The only `NEXT_PUBLIC_*` is the site URL.
  - The client components that import `@receipt-ocr/core` import types only.
  - No `.env` is tracked or was ever added in history.
  - The Docker context excludes `**/.env*`, and the image runs as a non-root user.
- **Rate limits:** sign-in 5 per 60 s, sign-up 3 per 60 s and invites 20 per hour per IP plus 10 per hour per inviter,
  all in a DB store. The client IP only comes from a configured header, and the app refuses to start off Vercel without
  one (`env.ts:185-195`). Uploads have a per-minute plan limit under the lock.
- **Supply chain:**
  - `check:deps` passes (exact pins).
  - `bunfig.toml` has a 7-day `minimumReleaseAge`, and the Vercel CLI has its own lockfile.
  - Dependabot cooldown is 7 days.
  - Every action is SHA-pinned, CI uses `permissions: contents: read`, and deploy workflows start from `permissions: {}`
    with `persist-credentials: false`.
  - There is no `pull_request_target` and no `${{ }}` inside `run:`.
  - Images are pinned by digest.
