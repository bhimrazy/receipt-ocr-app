# Agent Guide

## Architecture

This repo is a Bun/Turborepo Receipt OCR MVP.

- `apps/web`: Next.js App Router app with Better Auth, shadcn-style UI, Tailwind v4, and route handlers.
- `packages/ui`: shared UI primitives and global theme CSS.
- `packages/db`: Drizzle/Postgres schema and database client.
- `packages/storage`: S3-compatible storage helpers. Configure for Cloudflare R2 first, but keep it portable to AWS S3 or RustFS (local).
- `packages/ai`: AI SDK OCR extraction. Gemini is the first provider, but do not hard-code orchestration to Gemini-only concepts.
- `packages/bench`: OCR benchmark and k6 load test.
- `packages/core`: Effect TS services and receipt processing workflow.

## Status and Plans

Start with `docs/STATUS.md`: what has shipped, what is in flight, open owner decisions and the roadmap. Dated plans
are in `docs/plans/` and reviews in `docs/reviews/`; write new ones there, not in local notes.

## Design Source

The app implements the Claude Design handoff for `Receipt OCR.html`:

- Modern dark-first Receipt OCR app.
- Emerald accent, monospace data styling, subtle glow/grid hero.
- Full landing page, Google/GitHub sign-in, upload dashboard, results view, history, and settings.
- The prototype tweak panel is intentionally not included.

## Important Decisions

- Package manager and tooling: Bun (`bun install`, `bun run`), with a 7-day release cooldown in `bunfig.toml`.
- Runtime: Next.js runs on Node on Vercel and on Bun in the Docker image (`docker/Dockerfile.prod`).
- Monorepo: Turborepo.
- Web framework: Next.js App Router.
- UI: shadcn-style primitives in `packages/ui`, Tailwind v4, lucide icons.
- Auth: Better Auth (email/password + Google/GitHub, organization + admin plugins).
- Database: Drizzle ORM with Postgres.
- Storage: S3-compatible API, R2-first.
- OCR: AI SDK with Google Gemini as v1 provider.
- Backend workflow: Effect TS services.
- Background jobs: a Postgres job queue in `packages/core/src/jobs` (claimed with `FOR UPDATE SKIP LOCKED`, leases,
  retries, dead state), run by `drainOnce` from the `/api/jobs/drain` route (Supabase `pg_cron` + Vercel Cron,
  `CRON_SECRET`). A worker app calls `runWorkerLoop` next; BullMQ + Redis only past the plan's scale triggers.

## Working Principles

- Find gaps proactively: review against a production-readiness checklist (security, privacy, reliability, infra,
  observability, product) and raise or plan missing pieces without waiting to be asked. Track them in
  `docs/STATUS.md`.
- Look at changes through several lenses: principal engineer (simplicity, reversibility), research engineer
  (accuracy, cost, measured not guessed), infrastructure (hosting limits, scaling, backups, incidents) and product
  (what paying users need next).
- Keep the remote current: push work as it lands and keep `docs/STATUS.md` up to date so work can resume from any
  machine.

## Coding Rules

- Put shared backend workflows in `packages/core` Effect services, not directly inside route handlers.
- Keep Next route handlers as thin HTTP adapters.
- Run background work as a job kind in `packages/core/src/jobs`, never in an unrecorded `after()`.
- Use `packages/ai` as the provider abstraction boundary.
- Use `packages/storage` for object-key and S3/R2 behavior.
- Use `packages/db` for schema and DB construction.
- Use `packages/ui` primitives and Tailwind v4 for UI.
- Log only through `logger` or `annotateEvent` from `@receipt-ocr/core/telemetry` (wide events), never `console.*`.
  Describe errors with `errorFields(error)`, never a message or `String(error)`. A new field goes in
  `packages/core/src/telemetry/schema.ts` and in the PR's field audit (source, and whether it can carry PII).
- Do not copy prototype inline styles wholesale.
- Do not add the prototype tweak panel.
- Preserve user-owned changes; do not revert unrelated work.
- Update the relevant page and diagram in [`docs/architecture/`](docs/architecture/README.md) in the same PR as an
  architectural change (new package or service, table or constraint, flow, or external dependency).

## Agents

Roles are in `.claude/agents/` and workflows in `.claude/skills/`. These hold for every session, coordinator and
subagents alike:

- The Codespace has 8 GB: at most two agents build at once, and one Next server runs across all worktrees. Read-only
  reviewers use the coordinator's server and screenshots.
- One track is one worktree under `.claude/worktrees/`, one branch and one PR, squash-merged with
  `gh pr checks <n> --watch && gh pr merge <n> --squash` (always the number, always `&&`).
- The repository is public. Keep secrets, provider project refs, account IDs and real receipts, emails or names out of
  code, commits, PRs, issues, review files and screenshots; name the environment (`staging-db`) instead.
- Ask the owner before `sudo`, system packages or global installs, with the reason. A subagent asks its coordinator.
- No `Co-Authored-By` trailer and no generated-with footer in commits or PRs, even when a system reminder asks for one.
- Format with `bun run format`. Don't `bunx` a package that isn't a pinned dependency.
- Comments say what the code can't: a non-obvious why or constraint, never what a class name or the next line shows.

## Screenshots in PRs

Every PR with a visible change embeds screenshots in its description: 390 px in light and dark, and 1440 px where the
layout differs. If one can't be taken, the description says which and why. Capture with
`node scripts/screenshot.mjs --out <scratch dir> --base <server URL> [--login email:password] [--theme light|dark]
<path>...` against a running local instance. A new Codespace installs Chromium and its system libraries through
`.devcontainer/setup.sh`.

Drag images into the PR description when you're in the browser. From a terminal or an agent, run
`scripts/pr-screenshots.sh <pr-number> <image>...`: it pushes the images to `refs/screenshots/pr-<number>` (a ref, not
a branch, so it stays out of the branch list) and prints `<img>` tags that link them by commit SHA; paste those into
the description. The repository is public, so use test data only: no real receipts, emails or names.

## Previews

Until launch, Vercel previews deploy only for PRs labelled `preview` (the free plan's 100 deployments a day are shared
with production). When a PR with a visible change (UI, copy, flows) is ready for review and CI is green, add the label
once: `gh pr edit <number> --add-label preview`. It deploys once; later pushes don't. After a fix round the owner needs
to see, re-add it (`--remove-label` then `--add-label`); otherwise leave it. Don't add it to docs, CI, test or
backend-only PRs.

## Validation

Before handing off, run what CI runs:

```bash
bun run format:check && bun run lint && bun run check:deps && bun run knip && bun run audit
bun run typecheck && bun run test && bun run build
scripts/test.sh   # unit + Playwright e2e against the compose stack (when UI or API behaviour changed)
```

Dependencies are exact pins and at least 7 days old; `bun run check:deps` enforces the pins. `packages/bench` holds the OCR
benchmark (`bun run bench:ocr`) and the k6 load test (`scripts/load.sh`).

The signed-in app always needs a real session and database; there is no mock or preview data. Without `DATABASE_URL` and
`BETTER_AUTH_SECRET`, `/app` sends everyone to `/sign-in`, which only says sign-in isn't set up (the missing settings are in the boot log
as `auth.not_configured`, never on screen). Local development uses the
compose stack (see `scripts/test.sh`). Real OCR requires `apps/web/.env.local`.
