FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── all deps (dev + prod) — needed for build and workers ─────────────────────
FROM base AS deps-all
COPY package.json package-lock.json ./
RUN npm install

# ── app builder ───────────────────────────────────────────────────────────────
FROM deps-all AS builder
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npx prisma generate
RUN npm run build

# ── app runner ────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public          ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

# ── workers runner ────────────────────────────────────────────────────────────
FROM deps-all AS workers-runner
ENV NODE_ENV=production
COPY . .
RUN npx prisma generate
CMD ["npx", "tsx", "workers/index.ts"]
