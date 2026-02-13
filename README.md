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
# Configure the gateway
pnpm --filter @agentim/gateway start -- config \
  -s ws://localhost:3000/ws/gateway \
  -t YOUR_ACCESS_TOKEN

# Start with Claude Code agent
pnpm --filter @agentim/gateway start -- start \
  --agent claude:claude-code:/path/to/project
```

### Docker

```bash
cd docker

# Start the server
docker compose up -d

# Access Web UI at http://localhost:3000
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
