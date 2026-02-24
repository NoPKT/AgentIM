# AgentIM

Unified IM-style platform for managing and orchestrating multiple AI coding agents.

## Project Structure

- `packages/shared` - Shared types, WebSocket protocol, i18n, validators (Zod)
- `packages/server` - Hub server: Hono + PostgreSQL + Redis (Drizzle) + WebSocket
- `packages/gateway` - AgentIM CLI: child_process + CLI adapters
- `packages/web` - React 19 SPA/PWA: Vite + TailwindCSS v4

## Conventions

- **Language**: TypeScript (strict mode), ESM only
- **Style**: Prettier (no semi, single quotes, trailing commas)
- **Imports**: Use `@agentim/shared` for cross-package types
- **IDs**: Use `nanoid` for generating IDs
- **Errors**: Return proper HTTP status codes, never throw unhandled
- **WebSocket**: All messages use the protocol types from `@agentim/shared`
- **i18n**: All user-facing strings must use i18next keys, support EN + ZH-CN + JA + KO + FR + DE + RU
- **Versioning**: SemVer (0.x.y); CHANGELOG `[Unreleased]` always on top; never auto-create git tags or bump versions without explicit user request

## Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Dev mode (all packages)
pnpm --filter @agentim/server dev    # Dev server only
pnpm --filter @agentim/web dev       # Dev web only
pnpm --filter agentim dev            # Dev CLI only
```

## Environment Variables

See `.env.example` for all configuration options.
