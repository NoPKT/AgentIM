# Multi-stage build: Build web + server, serve together
FROM node:20-alpine AS base
RUN npm install -g pnpm@10.29.3

# ── Build stage ──
FROM base AS build
WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json turbo.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

# Build all packages
RUN pnpm build

# ── Production stage ──
FROM node:20-alpine AS production
RUN npm install -g pnpm@10.29.3
WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Create non-root user
RUN addgroup --system app && adduser --system --ingroup app app

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist

# Copy drizzle migrations
COPY --from=build /app/packages/server/drizzle packages/server/drizzle

ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/agentim
ENV REDIS_URL=redis://redis:6379
ENV NODE_ENV=production

# Ensure uploads dir is writable by non-root user
RUN mkdir -p /app/uploads && chown -R app:app /app/uploads

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health | grep -q '"ok":true' || exit 1

CMD ["node", "packages/server/dist/index.js"]
