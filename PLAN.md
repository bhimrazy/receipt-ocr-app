# Receipt OCR MVP Monorepo Plan

## Summary

Build a pnpm/Turborepo monorepo for a real Receipt OCR MVP using the provided Claude Design handoff as the visual target, with repo-structure inspiration from Dub and operational UI inspiration from Midday.

## Architecture

- `apps/web`: Next.js App Router app with shadcn/ui, Tailwind v4, Clerk, and route handlers.
- `packages/ui`: shared shadcn-style primitives, theme tokens, layout primitives.
- `packages/db`: Drizzle schema, migrations, typed queries.
- `packages/storage`: S3-compatible storage client, R2-first but portable to S3/RustFS.
- `packages/ai`: AI SDK OCR client and receipt schemas. Gemini is the initial provider.
- `packages/core`: Effect TS domain services, config, errors, and OCR workflow.
- Future background jobs target BullMQ + Redis; v1 stays synchronous.

## Product Scope

- Public `/` landing page: animated hero, receipt cards, stats, features, how-it-works, pricing, CTA, footer.
- Public `/sign-in`: Clerk sign-in with Google and GitHub only.
- Protected `/app/upload`: server-mediated receipt upload and synchronous OCR.
- Protected `/app/receipts/[id]`: receipt image preview, extracted data, JSON, export actions.
- Protected `/app/history`: searchable/filterable receipt table.
- Protected `/app/settings`: provider/storage/account settings UI.

## Backend Decisions

- Clerk protects `/app/*` and user-data API routes.
- Route handlers are thin HTTP adapters.
- Effect TS services own backend workflows and can later be reused by a BullMQ worker.
- Drizzle/Postgres stores receipts and receipt items.
- S3-compatible storage stores original receipt images.
- AI SDK is used for OCR provider abstraction, with Google Gemini as v1.

## Data Model

- `receipts`: `id`, `userId`, `merchant`, `receiptDate`, `category`, `currency`, `subtotal`, `tax`, `tip`, `total`, `confidence`, `status`, `imageObjectKey`, `rawJson`, `errorMessage`, timestamps.
- `receipt_items`: `id`, `receiptId`, `name`, `quantity`, `unitPrice`, `totalPrice`, `confidence`.
- Statuses: `uploaded`, `processing`, `completed`, `failed`.

## Design Notes

- Recreate the design’s look, not prototype internals.
- Use shadcn/ui, Tailwind v4, CSS variables, and lucide icons.
- Keep dark mode default with emerald accent and monospace data styling.
- Preserve glow/grid hero, uniform floating receipt cards, subtle animations, compact app sidebar, and polished data-heavy views.
- Do not include the prototype tweak panel.

## Validation Plan

- Run Turbo typecheck, lint, and build.
- Unit test Effect services with mocked DB/storage/AI layers.
- Unit test OCR response validation, receipt parsing, and object-key generation.
- Integration test protected upload route with mocked Clerk user and Effect test layers.
- UI smoke test landing, sign-in, auth redirect, upload, result, history, and settings.
