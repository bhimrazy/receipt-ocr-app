# Receipt OCR App

A pnpm/Turborepo Receipt OCR MVP with Next.js, Better Auth, Drizzle/Postgres, S3-compatible storage, Gemini OCR, shadcn/ui, Tailwind v4, and an Effect TS backend service layer.

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
cp .env.example .env                          # root env, read by docker compose
cp apps/web/.env.example apps/web/.env.local  # app env, read by `pnpm dev`
pnpm docker:up                                # Postgres + MinIO
pnpm db:migrate
pnpm dev
```

## Local development stack

`docker compose` brings up everything the app needs except the OCR provider:

| Service | What it is | Where |
| --- | --- | --- |
| `postgres` | Postgres 17 | `localhost:5432` (override with `POSTGRES_PORT`) |
| `minio` | S3-compatible storage, stands in for R2 | `localhost:9000`, console on `:9001` |
| `minio-init` | One-shot: creates the `receipt-ocr` bucket | exits when done |
| `migrate` | One-shot: applies drizzle migrations | exits when done |
| `app` | The Next.js app itself (profile `app`) | `localhost:3000` |

```bash
pnpm docker:up      # infra only — run the app with `pnpm dev`
pnpm docker:app     # ...plus the app in a container
pnpm docker:reset   # tear down and delete the volumes
```

If port 5432 is already taken by a local Postgres, set `POSTGRES_PORT=5433` in
`.env` and point `DATABASE_URL` at it.

For `pnpm dev`, `apps/web/.env.local` needs at minimum:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/receipt_ocr
BETTER_AUTH_SECRET=<openssl rand -base64 32>
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=receipt-ocr
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
GOOGLE_GENERATIVE_AI_API_KEY=<your key>
```

The UI renders without backend credentials. Real upload/OCR requires Better Auth (`BETTER_AUTH_SECRET`), Postgres (`DATABASE_URL`), S3/R2, and Gemini env vars. Apply migrations with `pnpm db:migrate` — against Supabase, that means the **session** pooler on port 5432 (set `DIRECT_URL`), not the transaction pooler.
