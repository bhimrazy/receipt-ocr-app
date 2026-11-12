---
name: review-round
description: Run the Receipt OCR review round — CTO, CEO, security, product and design reviewers in parallel, read-only — then turn findings into fixes or issues and report to the owner. Use when the owner asks for a review round or before merging a large branch.
---

# Review round

The machine has 8 GB: one Next server at a time across all worktrees, and at most two agents building at once.
Reviewers are read-only and share the server and screenshots from step 1.

1. **Prepare the app once.** Run the Validation block in `AGENTS.md` first and keep its output for the reviewers. Then
   export the env block from `scripts/test.sh` (compose Postgres and RustFS,
   `OCR_PROVIDER=fixture`, `DIRECT_URL` as well as `DATABASE_URL`; never a remote database or a real OCR provider; use the compose default database `receipt_ocr`), then
   `bun run docker:up`, `bun run db:migrate`, `bun run build` and `bun run start` in `apps/web`. The root `bun dev`
   ignores shell variables (Turbo strict env mode) and reads `apps/web/.env.local` instead. Seed receipts across
   statuses and currencies by uploading through the app (the fixture returns USD and EUR; a file containing
   `FIXTURE_FAIL` fails) and editing some to INR and NPR. Capture every route with
   `node scripts/screenshot.mjs --out <scratch dir> --base http://localhost:3004 --login <email:password>` at 1440 and
   390, in `--theme dark` and `--theme light`.

2. **Launch the reviewers in one message, in the background:** `cto-advisor`, `ceo-advisor` (includes market
   research), `security-reviewer`, `product-reviewer` and `principal-designer` (critique). All five are read-only in a
   round. Give each the date, the screenshot directory, the server URL and a test login, the gate output and its
   previous review file. Each writes `docs/reviews/<YYYY-MM-DD>-<cto|ceo|security|product|design>.md`.

3. **Consolidate.** Group findings by area and dedupe them. Owner-blocking items and anything touching auth, data loss
   or false claims become fix work now; the rest become GitHub issues citing the review file. The repository is public:
   an exploitable finding stays out of issues and committed files until its fix merges.

4. **Fix in waves.** Stop the step 1 server. Split the fixes into tracks that don't touch the same files, each an
   `engineer` in its own worktree with its own branch and PR. Run two at most and queue the rest; one track at a time
   holds the Next server slot. `engineer` runs on Sonnet; pass `model: opus` for a track that is hard to verify (auth,
   billing, migrations, concurrency). A PR merges when CI is green, an independent review has passed and, for a visible
   change, its description has screenshots: `gh pr checks <n> --watch && gh pr merge <n> --squash`. A merge to `main`
   deploys to production, so a PR with a migration or an open owner decision waits for the owner. After the wave, re-run
   the Validation block and the screenshot pass on `main` and compare with the step 1 screenshots.

5. **Report to the owner** in under ten lines: what changed, what's still open, and the decisions they need to make.
   Report only what actually ran. Update `docs/STATUS.md`.

6. **Clean up.** Stop every server you started (by the PID on its port), `git worktree remove` each track worktree,
   delete merged branches and drop per-track databases.
