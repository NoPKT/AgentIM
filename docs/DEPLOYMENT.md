# AgentIM Deployment Guide

## Prerequisites

| Component | Minimum Version | Notes |
|-----------|----------------|-------|
| Node.js | >= 20 | Runtime |
| pnpm | 10.29.3 | Package manager (locked via `packageManager` field) |
| PostgreSQL | 16 | Primary database |
| Redis | 7 | Cache and real-time messaging |
| Docker + Compose | Latest stable | Docker deployment only |

## Docker Deployment (Recommended)

### 1. Clone and configure

```bash
git clone <repository-url> agentim && cd agentim
cp .env.example .env
```

Edit `.env` — **required** variables:

```bash
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD=YourStrongPassword123
CORS_ORIGIN=https://your-domain.com
```

### 2. Start services

```bash
cd docker
docker compose up -d
```

### 3. Verify

```bash
curl http://localhost:3000/api/health
# {"ok":true,"timestamp":"...","checks":{"database":true,"redis":true}}
```

### Data persistence

| Volume | Purpose |
|--------|---------|
| `pgdata` | PostgreSQL data |
| `redisdata` | Redis persistence |
| `uploads_data` | User uploaded files |

## Manual Deployment

### 1. Install and build

```bash
corepack enable
corepack prepare pnpm@10.29.3 --activate

git clone <repository-url> agentim && cd agentim
pnpm install
pnpm build
```

### 2. Set up PostgreSQL and Redis

```bash
sudo -u postgres psql -c "CREATE USER agentim WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE agentim OWNER agentim;"
```

### 3. Configure and start

```bash
cp .env.example .env
# Edit .env with production values

NODE_ENV=production node packages/server/dist/index.js
```

For process management:

```bash
npm install -g pm2
pm2 start packages/server/dist/index.js --name agentim-server --env production
pm2 save && pm2 startup
```

The server automatically serves the web UI from `packages/web/dist/` in production.

## Gateway Deployment

The Gateway runs on developer machines and connects to the server via WebSocket.

```bash
GATEWAY_SERVER_URL=ws://your-server:3000/ws/gateway \
GATEWAY_TOKEN=your-token \
  node packages/gateway/dist/cli.js start
```

## Environment Variables

### Core

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `NODE_ENV` | — | Production | Set to `production` |
| `PORT` | `3000` | No | HTTP port |
| `HOST` | `0.0.0.0` | No | Bind address |

### Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/agentim` | Production | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Production | Redis connection string |

### Authentication

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `JWT_SECRET` | `dev-secret-change-me` | **Production** | Server refuses to start with default value. Use `openssl rand -base64 32` |
| `JWT_ACCESS_EXPIRY` | `15m` | No | Access token TTL |
| `JWT_REFRESH_EXPIRY` | `7d` | No | Refresh token TTL |
| `ADMIN_USERNAME` | `admin` | No | Admin user (auto-created on startup) |
| `ADMIN_PASSWORD` | (empty) | Docker | Admin password |

### Security

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `CORS_ORIGIN` | Dev: `http://localhost:5173`, Prod: `""` | **Production** | `*` causes fatal exit in production |

### File Upload

| Variable | Default | Description |
|----------|---------|-------------|
| `UPLOAD_DIR` | `./uploads` | Upload storage directory |
| `MAX_FILE_SIZE` | `10485760` (10 MB) | Max file size in bytes |

### AI Router (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTER_LLM_BASE_URL` | (empty) | OpenAI-compatible API URL. Without this, broadcast rooms only route via @mentions |
| `ROUTER_LLM_API_KEY` | (empty) | API key |
| `ROUTER_LLM_MODEL` | `gpt-oss-20b` | Model name |

### Routing Protection

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_AGENT_CHAIN_DEPTH` | `5` | Max agent chain depth |
| `AGENT_RATE_LIMIT_WINDOW` | `60` | Rate limit window (seconds) |
| `AGENT_RATE_LIMIT_MAX` | `20` | Max requests per window |

### Monitoring (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | (empty) | Sentry error tracking DSN |

## Security Checklist

- [ ] **`JWT_SECRET`**: Strong random value (`openssl rand -base64 32`)
- [ ] **`ADMIN_PASSWORD`**: Complex password
- [ ] **`CORS_ORIGIN`**: Set to your frontend domain (e.g. `https://app.example.com`)
- [ ] **`DATABASE_URL`**: Dedicated user with strong password
- [ ] **HTTPS**: Configure TLS via reverse proxy
- [ ] **Firewall**: Only expose ports 80/443; keep 5432/6379 internal
- [ ] **Redis auth**: Use `redis://:password@host:6379` format
- [ ] **`NODE_ENV=production`**: Enables CSP headers, hides error details

## Nginx Reverse Proxy

```nginx
upstream agentim {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name aim.example.com;

    ssl_certificate     /etc/letsencrypt/live/aim.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aim.example.com/privkey.pem;

    client_max_body_size 12M;

    # WebSocket
    location /ws/ {
        proxy_pass http://agentim;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }

    # API + static
    location / {
        proxy_pass http://agentim;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Health Check

```
GET /api/health
```

Returns `200` with `{"ok":true,"checks":{"database":true,"redis":true}}` when healthy, `503` when not.

Docker Compose includes built-in health checks for all services (postgres, redis, server).

## Backup & Maintenance

### Database backup

```bash
# Built-in script
pnpm --filter @agentim/server db:backup

# Manual
pg_dump "$DATABASE_URL" --no-owner --no-acl > backup-$(date +%Y%m%d).sql

# Docker
docker compose exec postgres pg_dump -U postgres agentim > backup.sql
```

### Restore

```bash
psql "$DATABASE_URL" < backup.sql
```

### Migrations

Migrations run automatically on server startup. Manual:

```bash
pnpm --filter @agentim/server db:migrate
```

### Upgrade procedure

```bash
pnpm --filter @agentim/server db:backup  # 1. Backup
git pull origin main                       # 2. Pull
pnpm install && pnpm build                 # 3. Build
pm2 restart agentim-server                 # 4. Restart (auto-migrates)
```

### Automatic maintenance

- Expired refresh tokens are cleaned up every hour
- Orphan upload files are cleaned periodically
- Agent rate limit keys auto-expire via Redis TTL
