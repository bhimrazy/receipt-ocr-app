# Receipt OCR App

A pnpm/Turborepo Receipt OCR MVP with Next.js, Clerk, Drizzle/Postgres, S3-compatible storage, Gemini OCR, shadcn/ui, Tailwind v4, and an Effect TS backend service layer.

## Apps and Packages

- `apps/web` - Next.js App Router web app.
- `packages/ui` - shared UI primitives.
- `packages/db` - Drizzle schema and repository helpers.
- `packages/storage` - R2/S3-compatible storage client.
- `packages/ai` - Gemini OCR client and schemas.
- `packages/core` - Effect services and receipt processing workflow.

## Local Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

The UI renders without backend credentials. Real upload/OCR requires Clerk, Postgres, S3/R2, and Gemini env vars.
