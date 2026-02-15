# @agentim/shared

Shared types, WebSocket protocol definitions, validators (Zod), and i18n for [AgentIM](https://github.com/NoPKT/AgentIM).

## Installation

```bash
npm install @agentim/shared
```

## What's Included

- **Types** -- TypeScript types for agents, rooms, messages, tasks, and users
- **Protocol** -- WebSocket message types for client, gateway, and server communication
- **Validators** -- Zod schemas for input validation
- **Constants** -- Agent types, routing modes, status codes
- **i18n** -- Translation strings for English, Chinese, Japanese, and Korean
- **Mentions** -- `@mention` parsing utilities

## Usage

```typescript
import type { Agent, Room, Message } from '@agentim/shared'
import { registerSchema, AGENT_TYPES } from '@agentim/shared'
```

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
