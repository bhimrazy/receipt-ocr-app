---
name: review-round
description: Run the Receipt OCR review round — CTO, CEO, security, product and design reviewers in parallel, read-only — then turn findings into fixes or issues and report to the owner. Use when the owner asks for a review round or before merging a large branch.
---

# Review round

1. **Prepare the app once.** `bun run docker:up`, `bun run db:migrate`, then `bun dev` with the local env overrides from
   `README.md` (local Postgres and RustFS only). Seed realistic receipts across statuses and currencies (USD, INR, NPR)
   without calling Gemini. Capture every route with `node scripts/screenshot.mjs` at 1440 and 390 into a scratch
   directory. Reviewers read these instead of each starting a server.

2. **Launch in parallel, in the background, in one message** (at most 5 agents at once):
   `cto-advisor`, `ceo-advisor` (includes market research), `security-reviewer`, `product-reviewer` and
   `principal-designer` in critique mode. Give each the date, the screenshot directory and its previous review file.
   Each writes `docs/reviews/<YYYY-MM-DD>-<kind>.md`; none edits code.

3. **Consolidate.** Group findings by area and dedupe them. Owner-blocking items and anything touching auth, data loss
   or false claims become fix work now; the rest become GitHub issues citing the review file.

4. **Fix in waves.** Split the fixes into tracks that don't touch the same files and run them in parallel, each in its own
   worktree. Re-run `bun run typecheck`, `bun run test`, `bun run build` and the screenshot pass on the merged result, then
   compare it with the step 1 screenshots.

5. **Report to the owner** in under ten lines: what changed, what's still open, and the decisions they need to make.
   Report only what actually ran.
