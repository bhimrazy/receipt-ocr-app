# Receipt OCR App

A Bun/Turborepo Receipt OCR MVP with Next.js, Better Auth, Drizzle/Postgres, S3-compatible storage, Gemini OCR, shadcn/ui, Tailwind v4, and an Effect TS backend service layer.

## Apps and Packages

- `apps/web` - Next.js App Router web app.
- `packages/core` - Effect services and receipt processing workflow.
- `packages/ai` - AI SDK OCR call, extraction schema, model list and prices (Gemini today).
- `packages/db` - Drizzle schema and the shared database client.
- `packages/storage` - R2/S3-compatible storage client.
- `packages/email` - Resend mailer and email templates.
- `packages/ui` - shared UI primitives.

How they fit together, with diagrams of every flow and the data model, is in
[`docs/architecture/`](docs/architecture/README.md).

## Local Setup

```bash
bun install
cp .env.example .env                          # root env, read by docker compose
cp apps/web/.env.example apps/web/.env.local  # app env, read by `bun dev`
bun run docker:up                                # Postgres + RustFS
bun run db:migrate
bun dev
```

Project status, open decisions and how to resume work are in [`docs/STATUS.md`](docs/STATUS.md); plans and
reviews are in [`docs/plans/`](docs/plans) and [`docs/reviews/`](docs/reviews).

Deploying to production, and the steps for each release (migrations, new variables, rollback), are in
[`docs/deployment.md`](docs/deployment.md).

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
bun run docker:up      # infra only; run the app with `bun dev`
bun run docker:app     # ...plus the production image (docker/Dockerfile.prod)
bun run docker:dev     # ...or `next dev` in a container (docker/Dockerfile.dev)
bun run docker:reset   # tear down and delete the volumes
```

Postgres is published on **5433**, not 5432, because 5432 is usually already
taken by another local Postgres. Change `POSTGRES_PORT` in `.env` if you'd
rather use a different one, and keep `DATABASE_URL` in step.

Containers carry no restart policy: once stopped they stay stopped until the
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

The UI renders without backend credentials. Real upload/OCR requires Better Auth (`BETTER_AUTH_SECRET`), Postgres (`DATABASE_URL`), S3/R2, and Gemini env vars. Apply migrations with `bun run db:migrate`. Against Supabase, that means the **session** pooler on port 5432 (set `DIRECT_URL`), not the transaction pooler.

### Self-hosting behind a proxy

Auth and contact-form rate limits key on the client IP. In production off Vercel the app refuses to start
unless `TRUSTED_IP_HEADERS` names the header your reverse proxy sets to the client IP (for example
`x-real-ip` or `x-forwarded-for`). If the proxy appends to `X-Forwarded-For` instead of overwriting it
(nginx `$proxy_add_x_forwarded_for`), also list the proxy's IPs or CIDR ranges in `TRUSTED_PROXIES`: the
client IP is then the right-most address not in that list. Only do this when clients can't reach the app
except through those proxies. On Vercel, leave both unset.

### Auth secret and stored tokens

Better Auth stores password-reset and verification tokens as hashes and seals OAuth tokens with the auth
secret, so the secret now protects stored data as well as sessions. To rotate it, set
`BETTER_AUTH_SECRETS=2:<new>,1:<old>` (current first) and keep `BETTER_AUTH_SECRET` set to the original
value until no token sealed under it remains. Older versions still decrypt; new data uses the first. Rotating
the current version signs everyone out. Keep every retired secret as long as you keep database backups made
under it.

## Testing & benchmarks

```bash
bun run test            # unit tests (Vitest)
bun run test:e2e        # Playwright smoke suite; needs a built app and the stack (below)
scripts/test.sh         # compose Postgres + RustFS, fresh test database, unit + e2e
bun run bench:ocr       # OCR accuracy/latency/cost on bench/fixtures (needs a Gemini key)
```

The e2e suite (`apps/web/e2e`) drives the built app through the UI, with receipts seeded in SQL rather than
through OCR. First run: `bunx playwright install chromium`. The upload spec runs only with `E2E_UPLOAD=1` and the
fixture OCR provider (`OCR_PROVIDER=fixture`), which CI and `scripts/test.sh` set. Benchmark details and the k6 upload load
test are in [`bench/README.md`](bench/README.md).

CI (`.github/workflows/ci.yml`) runs the checks below, which you can run locally too:

| Script                 | Checks                                                  |
| ---------------------- | ------------------------------------------------------- |
| `bun run format:check` | Prettier (`bun run format` to fix)                      |
| `bun run lint`         | ESLint with `eslint-config-next`                        |
| `bun run check:deps`   | One version per package, exact pins, `bun.lock` in sync |
| `bun run knip`         | Unused files and dependencies                           |
| `bun run audit`        | `bun audit`, failing on high or critical                |
| `bun run typecheck`    | `tsc` in every package and in `bench/`                  |
