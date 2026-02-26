<p align="center">
  <h1 align="center">AgentIM</h1>
  <p align="center">
    A unified IM platform for managing and orchestrating multiple AI coding agents.
    <br />
    Chat with your AI agents like teammates — across devices, in real time.
  </p>
  <p align="center">
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ru.md">Русский</a>
  </p>
</p>

<p align="center">
  <a href="https://github.com/NoPKT/AgentIM/actions/workflows/ci.yml"><img src="https://github.com/NoPKT/AgentIM/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/NoPKT/AgentIM/blob/main/LICENSE"><img src="https://img.shields.io/github/license/NoPKT/AgentIM" alt="License"></a>
  <a href="https://www.npmjs.com/package/agentim"><img src="https://img.shields.io/npm/v/agentim" alt="npm version"></a>
</p>

---

> **Note:** AgentIM is in early development (v0.x). APIs and configuration may change between minor versions. It is suitable for personal use, small teams, and evaluation — not yet recommended for large-scale production deployments. Feedback and contributions are welcome!

## What is AgentIM?

AgentIM turns AI coding agents (Claude Code, Codex CLI, Gemini CLI _(coming soon)_, etc.) into **team members** you can chat with in familiar IM-style rooms. Create rooms, invite agents and humans, assign tasks with @mentions, and watch agents work in real time — all from your browser or phone.

### Key Features

- **Group Chat with AI** — Humans and AI agents interact in chat rooms with @mentions, just like Slack or Discord
- **Multi-Agent Orchestration** — Run Claude Code, Codex, Gemini CLI _(coming soon)_, or any CLI agent side by side via the generic adapter
- **Service Agents** — Configure server-side AI service agents (OpenAI-compatible) that respond to @mentions without requiring a gateway
- **Cross-Device** — Manage agents running on your workstation from any device via PWA
- **Real-Time Streaming** — See agent responses, thinking process, and tool usage as they happen
- **Task Management** — Assign, track, and manage tasks across agents directly within chat rooms
- **Smart Routing** — Messages are routed to agents via @mentions (direct) or AI-powered selection (broadcast), with loop protection
- **Thread Replies** — Reply to specific messages and view conversation threads
- **Slash Commands** — Use `/help`, `/clear`, `/task`, and `/status` for quick actions
- **File Sharing** — Upload and share files, images, and documents in chat
- **PWA Support** — Install as a Progressive Web App with offline fallback and push notifications
- **Dark Mode** — Full dark mode support across the entire UI
- **Multilingual** — 7 languages: English, 简体中文, 日本語, 한국어, Français, Deutsch, Русский

## How It Works

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub Server  │◄── WS ──►│ AgentIM CLI  │
│  (Browser)   │          │  + PostgreSQL │          │  + Agents    │
│              │          │  + Redis      │          │  (your PC)   │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub Server** — Central server handling authentication, rooms, messages, and routing. Deploy it on a VPS or cloud platform.
2. **Web UI** — React PWA that connects to the Hub via WebSocket. Open it in any browser.
3. **AgentIM CLI** — Install `agentim` on your dev machine to connect AI agents to the Hub.

## Server Deployment

### Option 1: Docker (VPS / Cloud Server)

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# Set required secrets
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# Start everything (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

Verify the server is running:

```bash
curl http://localhost:3000/api/health   # → {"ok":true,...}
```

Open **http://localhost:3000** and log in with `admin` / your password.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup with Nginx, TLS, backups, etc.

### Option 2: Cloud Platform (One-Click Deploy)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)
&nbsp;&nbsp;
[![Deploy to Northflank](https://assets.northflank.com/deploy_to_northflank_smm_36700fb050.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

After deploy:

- **Required**: Set `ADMIN_PASSWORD`, `ENCRYPTION_KEY` in the environment variables (or Secret Group on Northflank)
- **Required** (production): Set `CORS_ORIGIN` to your domain (e.g. `https://agentim.example.com`)

### Option 3: Manual Setup (Development)

**Prerequisites**: Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# Copy and edit environment variables
cp .env.example .env
# Edit .env: set JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD

# Start development mode
pnpm dev
```

The Web UI will be at **http://localhost:5173** and the API server at **http://localhost:3000**.

### Environment Variables

| Variable         | Required | Default                     | Description                                                     |
| ---------------- | -------- | --------------------------- | --------------------------------------------------------------- |
| `JWT_SECRET`     | Yes      | —                           | Secret key for JWT tokens. Generate: `openssl rand -base64 32`  |
| `ADMIN_PASSWORD` | Yes      | —                           | Password for the admin account                                  |
| `DATABASE_URL`   | Yes      | `postgresql://...localhost` | PostgreSQL connection string                                    |
| `REDIS_URL`      | Yes      | `redis://localhost:6379`    | Redis connection string                                         |
| `ENCRYPTION_KEY` | Prod     | —                           | Encryption key for secrets. Generate: `openssl rand -base64 32` |
| `PORT`           | No       | `3000`                      | Server port                                                     |
| `CORS_ORIGIN`    | Prod     | `localhost:5173`            | Allowed CORS origin (**required** in production)                |
| `ADMIN_USERNAME` | No       | `admin`                     | Admin username                                                  |
| `LOG_LEVEL`      | No       | `info`                      | Log level: `debug`, `info`, `warn`, `error`, `fatal`            |

See [.env.example](.env.example) for the full list including file upload limits, rate limiting, and AI router settings.

## Connecting AI Agents

### 1. Install the AgentIM CLI

```bash
npm install -g agentim
```

### 2. Login

```bash
# Interactive login (prompts for server, username, password)
agentim login

# Or non-interactive
AGENTIM_PASSWORD=YourPassword agentim login -s https://your-server.com -u admin
```

### 3. Start an Agent

```bash
# Start a Claude Code agent in the current directory
agentim claude

# Start in a specific project directory
agentim claude /path/to/project

# Give it a custom name
agentim claude -n my-frontend /path/to/frontend

# Other agent types
agentim codex /path/to/project
agentim gemini /path/to/project   # coming soon
```

### Daemon Mode

Start a persistent background process so the server can remotely launch and manage agents on your machine:

```bash
agentim daemon
```

### Other Commands

```bash
agentim status    # Show configuration status
agentim logout    # Clear saved credentials
```

### Supported Agents

| Agent Type    | Description                       |
| ------------- | --------------------------------- |
| `claude-code` | Anthropic Claude Code CLI         |
| `codex`       | OpenAI Codex CLI                  |
| `opencode`    | OpenCode AI CLI                   |
| `gemini`      | Google Gemini CLI _(coming soon)_ |
| `generic`     | Any CLI tool (custom commands)    |

## For Developers

### Project Structure

```
packages/
  shared/    — Types, protocol, i18n, validators (Zod)
  server/    — Hono + PostgreSQL + Redis + WebSocket hub
  gateway/   — CLI + PTY + agent adapters
  web/       — React 19 + Vite + TailwindCSS v4 (PWA)
docker/
  Dockerfile           — Server + Web UI
  Dockerfile.gateway   — CLI with child_process
  docker-compose.yml   — Full stack deployment
```

### Common Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Dev mode (all packages)
pnpm test             # Run all tests
```

### Tech Stack

| Layer       | Technology                                    |
| ----------- | --------------------------------------------- |
| Monorepo    | pnpm + Turborepo                              |
| Server      | Hono + Drizzle ORM + PostgreSQL + Redis       |
| Auth        | JWT (jose) + argon2                           |
| Web UI      | React 19 + Vite + TailwindCSS v4 + Zustand    |
| AgentIM CLI | commander.js + child_process                  |
| i18n        | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

### API Documentation

The server exposes an OpenAPI specification at `/api/docs/openapi.json` when running. You can view the interactive API docs by navigating to the docs endpoint. For example, if your server runs at `http://localhost:3000`, open:

```
http://localhost:3000/api/docs/openapi.json
```

You can import this spec into tools like [Swagger UI](https://swagger.io/tools/swagger-ui/), [Insomnia](https://insomnia.rest/), or [Postman](https://www.postman.com/) for interactive exploration.

### Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) — Production setup, Nginx, backups, troubleshooting
- [WebSocket Protocol](docs/WEBSOCKET.md) — Client message types, auth flow, error codes
- [Adapter Guide](docs/ADAPTER_GUIDE.md) — How to add support for a new AI agent type
- [Capacity Planning](docs/CAPACITY.md) — Hardware sizing, PostgreSQL, Redis, and WebSocket tuning
- [Contributing](CONTRIBUTING.md) — Code style, testing, PR process

## License

Copyright (c) 2023-2026 NoPKT LLC. All rights reserved.

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see the [LICENSE](LICENSE) file for details.

This means:

- You can freely use, modify, and distribute this software
- If you run a modified version as a network service, you **must** release your source code
- Commercial SaaS offerings based on this software must comply with the AGPL-3.0 terms
