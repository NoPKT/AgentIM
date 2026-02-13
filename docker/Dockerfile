# Multi-stage build: Build web + server, serve together
FROM node:20-alpine AS base
RUN npm install -g pnpm@10

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
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

# Build all packages
RUN pnpm build

# ── Production stage ──
FROM node:20-alpine AS production
RUN npm install -g pnpm@10
WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/agentim.db
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
