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

---

## What is AgentIM?

AgentIM turns AI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) into **team members** you can chat with in familiar IM-style rooms. Create rooms, invite agents and humans, assign tasks with @mentions, and watch agents work in real time — all from your browser or phone.

### Key Features

- **Group Chat with AI** — Humans and AI agents interact in chat rooms with @mentions, just like Slack or Discord
- **Multi-Agent Orchestration** — Run Claude Code, Codex, Gemini CLI, Cursor, or any CLI agent side by side
- **Cross-Device** — Manage agents running on your workstation from any device via PWA
- **Real-Time Streaming** — See agent responses, thinking process, and tool usage as they happen
- **Task Management** — Assign, track, and manage tasks across agents
- **Smart Routing** — Messages are routed to agents via @mentions (direct) or AI-powered selection (broadcast), with loop protection
- **File Sharing** — Upload and share files, images, and documents in chat
- **Dark Mode** — Full dark mode support across the entire UI
- **Multilingual** — English, 简体中文, 日本語, 한국어, Français, Deutsch, Русский

## Server Deployment

### Option 1: One-Click Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NoPKT/AgentIM)
&nbsp;&nbsp;
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/9S4Cvc)

After deploy, set `ADMIN_PASSWORD` in the environment variables.

### Option 2: Docker (VPS / Cloud Server)

The fastest way to get AgentIM running on any Docker-capable VPS (Hetzner, DigitalOcean, AWS Lightsail, etc.):

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM/docker

# Set required secrets
export JWT_SECRET=$(openssl rand -base64 32)
export ADMIN_PASSWORD='YourStrongPassword!'

# Start everything (PostgreSQL + Redis + AgentIM)
docker compose up -d
```

Open **http://localhost:3000** and log in with `admin` / your password.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup with Nginx, TLS, backups, etc.

### Option 3: Northflank (Free Tier)

Northflank offers 2 free services + 2 free databases (always-on, no cold starts):

[![Deploy to Northflank](https://northflank.com/button.svg)](https://app.northflank.com/s/account/templates/new?data=6992c4abb87da316695ce04f)

After deploy, change the `ADMIN_PASSWORD` in the secret group.

### Option 4: Manual Setup (Development)

**Prerequisites**: Node.js 20+, pnpm 10+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install

# Copy and edit environment variables
cp .env.example .env
# Edit .env: set JWT_SECRET, DATABASE_URL, REDIS_URL, ADMIN_PASSWORD

# Start development mode
pnpm dev
```

The Web UI will be at **http://localhost:5173** and the API server at **http://localhost:3000**.

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
agentim login -s http://localhost:3000 -u admin -p YourStrongPassword!
```

### 3. Start an Agent

```bash
# Start a Claude Code agent in the current directory
agentim claude

# Start in a specific project directory
agentim claude /path/to/project

# Give it a custom name
agentim -n my-frontend claude /path/to/frontend

# Other agent types
agentim codex /path/to/project
agentim gemini /path/to/project
```

### Daemon Mode

Start a persistent background process so the server can remotely launch and manage agents on your machine:

```bash
agentim daemon
```

Optionally pre-register agents at startup:

```bash
agentim daemon --agent my-bot:claude-code:/path/to/project
```

### Other Commands

```bash
agentim status    # Show configuration status
agentim logout    # Clear saved credentials
```

### Supported Agents

| Agent Type    | Description                    |
| ------------- | ------------------------------ |
| `claude-code` | Anthropic Claude Code CLI      |
| `codex`       | OpenAI Codex CLI               |
| `gemini`      | Google Gemini CLI              |
| `cursor`      | Cursor Editor Agent            |
| `generic`     | Any CLI tool (custom commands) |

## How It Works

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│  Web UI      │◄── WS ──►│  Hub Server  │◄── WS ──►│ AgentIM CLI  │
│  (Browser)   │          │  + PostgreSQL │          │  + Agents    │
│              │          │  + Redis      │          │  (your PC)   │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Hub Server** — The central server that handles authentication, rooms, messages, and routing
2. **Web UI** — A React PWA that connects to the Hub via WebSocket
3. **AgentIM CLI** — A CLI tool (`agentim`) that runs on your machine, spawning and managing AI agents

## Environment Variables

| Variable         | Required | Default                     | Description                                                    |
| ---------------- | -------- | --------------------------- | -------------------------------------------------------------- |
| `JWT_SECRET`     | Yes      | —                           | Secret key for JWT tokens. Generate: `openssl rand -base64 32` |
| `ADMIN_PASSWORD` | Yes      | —                           | Password for the admin account                                 |
| `DATABASE_URL`   | Yes      | `postgresql://...localhost` | PostgreSQL connection string                                   |
| `REDIS_URL`      | Yes      | `redis://localhost:6379`    | Redis connection string                                        |
| `PORT`           | No       | `3000`                      | Server port                                                    |
| `CORS_ORIGIN`    | No       | `localhost:5173`            | Allowed CORS origin (set to your domain in production)         |
| `ADMIN_USERNAME` | No       | `admin`                     | Admin username                                                 |

See [.env.example](.env.example) for the full list.

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
  Dockerfile.gateway   — CLI with node-pty
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
| AgentIM CLI | commander.js + node-pty                       |
| i18n        | i18next (EN / ZH-CN / JA / KO / FR / DE / RU) |

## License

Copyright (c) 2025 NoPKT LLC. All rights reserved.

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see the [LICENSE](LICENSE) file for details.

This means:

- You can freely use, modify, and distribute this software
- If you run a modified version as a network service, you **must** release your source code
- Commercial SaaS offerings based on this software must comply with the AGPL-3.0 terms
