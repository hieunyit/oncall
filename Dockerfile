FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── prisma generate ───────────────────────────────────────────────────────────
FROM deps AS prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN ./node_modules/.bin/prisma generate

# ── builder ───────────────────────────────────────────────────────────────────
FROM prisma AS builder
COPY . .
RUN npm run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* && \
    addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public          ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
