# syntax=docker/dockerfile:1

# Monorepo-aware build. The whole workspace is copied because the web app
# depends on five workspace packages that Next transpiles from source.

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile

# Opt in to the standalone bundle only for the image; Vercel builds normally.
ENV NEXT_OUTPUT=standalone
RUN pnpm --filter @receipt-ocr/web build

# `output: "standalone"` emits a self-contained server plus only the
# node_modules it actually reached, which keeps the runtime image small.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
