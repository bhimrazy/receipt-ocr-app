# Receipt OCR App

A Bun/Turborepo Receipt OCR MVP with Next.js, Better Auth, Drizzle/Postgres, S3-compatible storage, Gemini OCR, shadcn/ui, Tailwind v4, and an Effect TS backend service layer.

## Apps and Packages

- `apps/web` - Next.js App Router web app.
- `packages/ui` - shared UI primitives.
- `packages/db` - Drizzle schema and repository helpers.
- `packages/storage` - R2/S3-compatible storage client.
- `packages/ai` - Gemini OCR client and schemas.
- `packages/core` - Effect services and receipt processing workflow.

## Local Setup

```bash
bun install
cp .env.example .env                          # root env, read by docker compose
cp apps/web/.env.example apps/web/.env.local  # app env, read by `bun dev`
bun run docker:up                                # Postgres + RustFS
bun run db:migrate
bun dev
```

## Local development stack

`docker compose` brings up everything the app needs except the OCR provider:

| Service       | What it is                                 | Where                                            |
| ------------- | ------------------------------------------ | ------------------------------------------------ |
| `postgres`    | Postgres 18                                | `localhost:5433` (override with `POSTGRES_PORT`) |
| `rustfs`      | S3-compatible storage, stands in for R2    | `localhost:9000`, console on `:9001`             |
| `rustfs-init` | One-shot: creates the `receipt-ocr` bucket | exits when done                                  |
| `migrate`     | One-shot: applies drizzle migrations       | exits when done                                  |
| `app`         | The Next.js app itself (profile `app`)     | `localhost:3000`                                 |

```bash
bun run docker:up      # infra only — run the app with `bun dev`
bun run docker:app     # ...plus the production image (docker/Dockerfile.prod)
bun run docker:dev     # ...or `next dev` in a container (docker/Dockerfile.dev)
bun run docker:reset   # tear down and delete the volumes
```

Postgres is published on **5433**, not 5432, because 5432 is usually already
taken by another local Postgres. Change `POSTGRES_PORT` in `.env` if you'd
rather use a different one, and keep `DATABASE_URL` in step.

Containers carry no restart policy — once stopped they stay stopped until the
next `bun run docker:up`.

For `bun dev`, `apps/web/.env.local` needs at minimum:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5433/receipt_ocr
BETTER_AUTH_SECRET=<openssl rand -base64 32>
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=receipt-ocr
S3_ACCESS_KEY_ID=rustfsadmin
S3_SECRET_ACCESS_KEY=rustfsadmin
S3_FORCE_PATH_STYLE=true
GOOGLE_GENERATIVE_AI_API_KEY=<your key>
```

The UI renders without backend credentials. Real upload/OCR requires Better Auth (`BETTER_AUTH_SECRET`), Postgres (`DATABASE_URL`), S3/R2, and Gemini env vars. Apply migrations with `bun run db:migrate` — against Supabase, that means the **session** pooler on port 5432 (set `DIRECT_URL`), not the transaction pooler.
