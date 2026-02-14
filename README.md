# AgentIM (AIM)

Unified IM-style platform for managing and orchestrating multiple AI coding agents across devices.

## Features

- **Group Chat Metaphor**: Humans and AI agents interact in chat rooms with @mentions
- **Multi-Agent Support**: Claude Code, Codex, Gemini CLI, Cursor, and generic adapters
- **Cross-Device**: Manage agents from any device via Web UI (PWA)
- **Streaming Output**: Real-time agent response streaming
- **Task Management**: Assign and track tasks across agents
- **i18n**: English, 简体中文, 日本語, 한국어

## Architecture

```
Web UI (PWA)  ←── WebSocket ──→  Hub Server  ←── WebSocket ──→  Agent Gateway(s)
                                 + SQLite                        + CLI adapters
```

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 10

### Development

```bash
# Install dependencies
pnpm install

# Start all packages in dev mode
pnpm dev

# Or start individually:
pnpm --filter @agentim/server dev    # Server on :3000
pnpm --filter @agentim/web dev       # Web UI on :5173
```

### Gateway Setup

```bash
# 1. Login (saves token to ~/.agentim/gateway.json)
pnpm --filter @agentim/gateway start -- login \
  -s http://localhost:3000 \
  -u your_username \
  -p your_password

# 2. Start with Claude Code agent
pnpm --filter @agentim/gateway start -- start \
  --agent claude:claude-code:/path/to/project
```

The gateway automatically refreshes expired tokens. You can register multiple agents:

```bash
pnpm --filter @agentim/gateway start -- start \
  --agent mybot1:claude-code:/project1 \
  --agent mybot2:generic:/project2
```

### Docker

```bash
cd docker

# Start the server
docker compose up -d

# Access Web UI at http://localhost:3000
```

### Testing

```bash
# Run all tests (34 tests covering API + WebSocket)
pnpm test

# Full local CI (build + test)
bash scripts/ci.sh
```

## Project Structure

```
packages/
  shared/    - Types, protocol, i18n, validators
  server/    - Hono + SQLite + WebSocket hub
  gateway/   - CLI + PTY + agent adapters
  web/       - React 19 + Vite + TailwindCSS v4
docker/
  Dockerfile           - Server + Web UI
  Dockerfile.gateway   - Gateway with node-pty
  docker-compose.yml
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Monorepo | pnpm + Turborepo |
| Server | Hono + better-sqlite3 + Drizzle ORM |
| Auth | JWT (jose) + argon2 |
| Web UI | React 19 + Vite + TailwindCSS v4 + Zustand |
| Gateway | commander.js + node-pty |
| i18n | i18next |

## Environment Variables

See [.env.example](.env.example) for all configuration options.

## License

MIT
