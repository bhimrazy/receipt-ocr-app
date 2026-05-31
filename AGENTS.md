# Agent Guide

## Architecture

This repo is a pnpm/Turborepo Receipt OCR MVP.

- `apps/web`: Next.js App Router app with Clerk, shadcn-style UI, Tailwind v4, and route handlers.
- `packages/ui`: shared UI primitives and global theme CSS.
- `packages/db`: Drizzle/Postgres schema and database client.
- `packages/storage`: S3-compatible storage helpers. Configure for Cloudflare R2 first, but keep it portable to AWS S3 or MinIO.
- `packages/ai`: AI SDK OCR extraction. Gemini is the first provider, but do not hard-code orchestration to Gemini-only concepts.
- `packages/core`: Effect TS services and receipt processing workflow.

## Design Source

The app implements the Claude Design handoff for `Receipt OCR.html`:

- Modern dark-first Receipt OCR app.
- Emerald accent, monospace data styling, subtle glow/grid hero.
- Full landing page, Google/GitHub sign-in, upload dashboard, results view, history, and settings.
- The prototype tweak panel is intentionally not included.

## Important Decisions

- Package manager: pnpm.
- Monorepo: Turborepo.
- Web framework: Next.js App Router.
- UI: shadcn-style primitives in `packages/ui`, Tailwind v4, lucide icons.
- Auth: Clerk with Google/GitHub.
- Database: Drizzle ORM with Postgres.
- Storage: S3-compatible API, R2-first.
- OCR: AI SDK with Google Gemini as v1 provider.
- Backend workflow: Effect TS services.
- Future jobs: BullMQ + Redis later; v1 upload is synchronous.

## Coding Rules

- Put shared backend workflows in `packages/core` Effect services, not directly inside route handlers.
- Keep Next route handlers as thin HTTP adapters.
- Keep OCR processing reusable for a future `apps/worker` BullMQ app.
- Use `packages/ai` as the provider abstraction boundary.
- Use `packages/storage` for object-key and S3/R2 behavior.
- Use `packages/db` for schema and DB construction.
- Use `packages/ui` primitives and Tailwind v4 for UI.
- Do not copy prototype inline styles wholesale.
- Do not add the prototype tweak panel.
- Preserve user-owned changes; do not revert unrelated work.

## Validation

Before handing off, prefer:

```bash
pnpm typecheck
pnpm build
```

If credentials are missing, the UI should still render with mock receipt data. Real OCR requires `apps/web/.env.local`.
