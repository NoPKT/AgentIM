# AgentIM Architecture

## Overview

AgentIM is a unified IM-style platform for managing and orchestrating multiple AI coding agents. It uses a Hub-and-Spoke topology where a central server coordinates messages between browser clients, CLI gateways, and AI agents.

```
┌─────────────────────────────────────────────────────────┐
│                     Browser Clients                      │
│              (React 19 SPA / PWA)                       │
└──────────────────────┬──────────────────────────────────┘
                       │  WebSocket /ws/client
                       │  REST  /api/*
┌──────────────────────▼──────────────────────────────────┐
│                    Hub Server                            │
│         Hono · PostgreSQL · Redis                        │
│                                                         │
│  ┌─────────────┐   ┌────────────┐   ┌───────────────┐  │
│  │  REST API   │   │  WS Client │   │  WS Gateway   │  │
│  │  /api/*     │   │  Handler   │   │  Handler      │  │
│  └──────┬──────┘   └─────┬──────┘   └───────┬───────┘  │
│         │                │                  │           │
│  ┌──────▼────────────────▼──────────────────▼───────┐  │
│  │               Core Services                       │  │
│  │  Auth · RateLimit · Sanitize · SSRF Check        │  │
│  │  TokenRevocation · AES-256-GCM Crypto            │  │
│  └──────┬────────────────────────────┬──────────────┘  │
│         │                            │                  │
│  ┌──────▼──────┐            ┌────────▼────────┐        │
│  │ PostgreSQL  │            │     Redis        │        │
│  │ (Drizzle)   │            │ Rate Limit · JWT │        │
│  │             │            │ Revocation ·     │        │
│  │ users       │            │ Agent Loop Detect│        │
│  │ rooms       │            └─────────────────┘        │
│  │ messages    │                                        │
│  │ agents      │                                        │
│  │ tasks       │                                        │
│  │ routers     │                                        │
│  └─────────────┘                                        │
└──────────────────────┬──────────────────────────────────┘
                       │  WebSocket /ws/gateway
┌──────────────────────▼──────────────────────────────────┐
│                  AgentIM CLI Gateways                    │
│              (Node.js, one per machine)                  │
│                                                         │
│   ┌──────────────┐    ┌──────────────┐                 │
│   │  Claude Code │    │   Cursor AI  │  … more agents  │
│   │  (CLI Agent) │    │  (CLI Agent) │                 │
│   └──────────────┘    └──────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description | Key Technologies |
|---------|-------------|-----------------|
| `@agentim/shared` | Shared types, Zod validators, WebSocket protocol, i18n | TypeScript, Zod, i18next |
| `@agentim/server` | Hub server: REST API + dual WebSocket endpoints | Hono, PostgreSQL, Redis, Drizzle ORM |
| `agentim` (gateway) | CLI gateway: spawns and manages AI coding agents | Node.js, CLI adapters |
| `@agentim/web` | Browser SPA/PWA | React 19, React Router 7, TailwindCSS v4, Zustand |

## Data Flow

### User Sends Message

```
Browser
  │  1. client:send_message (WS)
  ▼
Server (clientHandler)
  │  2. Verify membership (DB transaction)
  │  3. Sanitize content (XSS)
  │  4. Persist message (PostgreSQL)
  │  5. server:new_message → all room clients (WS broadcast)
  │  6. Resolve routing:
  │     a. Direct mention: @agent-name → target agent only
  │     b. Broadcast + AI Router → LLM selects agent(s)
  │     c. No routing condition → display only
  ▼
Server (gatewayHandler)
  │  7. server:send_to_agent → target Gateway (WS)
  ▼
Gateway
  │  8. Spawn/route to CLI agent
  │  9. gateway:message_chunk (streaming) → Server
  │  10. gateway:message_complete → Server
  ▼
Server
  │  11. Persist agent response (PostgreSQL)
  │  12. server:message_complete → all room clients (WS broadcast)
  ▼
Browser renders agent response
```

### Agent-to-Agent Routing

When an agent's response contains `@mentions` of other agents, the server
automatically routes the message to the mentioned agents (up to `maxChainDepth`
hops). Loop detection uses a Redis visited-set per `conversationId` to prevent
`A → B → A` cycles.

```
Agent A response contains "@AgentB"
  │
Server (gatewayHandler.routeAgentToAgent)
  │  1. Check chain depth < maxChainDepth
  │  2. Redis SADD conversationId:visited AgentA
  │  3. SISMEMBER check for AgentB (not visited)
  │  4. server:send_to_agent → AgentB gateway
  ▼
Agent B responds (depth + 1)
```

## WebSocket Protocol

Two separate WebSocket endpoints with distinct authentication models:

| Endpoint | Clients | Auth Token |
|----------|---------|------------|
| `/ws/client` | Browser clients | JWT access token (Bearer) |
| `/ws/gateway` | CLI gateways | JWT access token (same) |

All connections must authenticate within `WS_AUTH_TIMEOUT_MS` (default 10s) or
be closed with code `4001`.

See [`WEBSOCKET.md`](./WEBSOCKET.md) for the full message protocol reference.

## Security Architecture

### Defense in Depth

```
Network Layer
  └─ CORS strict origin validation
  └─ Rate limiting: IP-based (Redis Lua atomic INCR)
       Auth:     10 req/min
       API:     120 req/min
       Upload:   10 req/min
       WS upgrade: 30/min

Application Layer
  └─ Zod input validation on all API + WS messages
  └─ JSON depth + collection size limits (WS DoS prevention)
  └─ Content sanitization: server-side XSS strip + client-side rehype-sanitize
  └─ Server-side mention parsing (never trust client-provided @mentions)
  └─ File upload: MIME type whitelist + magic byte validation

Authentication Layer
  └─ argon2id password hashing
  └─ JWT (HS256) access + refresh token pair
  └─ Refresh tokens: argon2 hashed in DB + rotation on use
  └─ pg_advisory_xact_lock prevents concurrent refresh races
  └─ Token revocation via Redis timestamp (logout / password change)
  └─ WS auth: max 5 attempts per socket connection
  └─ Account lockout: 5 failed attempts → 15 min lockout
  └─ Timing-safe dummy hash for non-existent users

Data Layer
  └─ Drizzle ORM parameterized queries (SQL injection prevention)
  └─ Router API keys: AES-256-GCM encrypted in DB
  └─ SSRF protection: private IP range check + DNS resolution on Router URLs
  └─ Path traversal prevention on file operations
```

### Secret Storage

| Secret | Storage | Protection |
|--------|---------|------------|
| User passwords | PostgreSQL | argon2id hash |
| Refresh tokens | PostgreSQL | argon2 hash |
| Router API keys | PostgreSQL | AES-256-GCM (ENCRYPTION_KEY) |
| JWT secret | Environment | In-memory only |
| Admin password | Environment | argon2 hashed on first use |

## Database Schema (Key Tables)

```
users
  ├─ id, username, passwordHash, displayName, role
  ├─ failedLoginAttempts, lockedUntil
  └─ maxWsConnections, maxGateways

rooms
  ├─ id, name, type, broadcastMode
  ├─ systemPrompt, routerId
  └─ createdById, pinnedAt, archivedAt

room_members
  ├─ roomId, memberId, memberType (user|agent)
  ├─ role (owner|admin|member)
  └─ lastReadAt, notificationPref

messages
  ├─ id, roomId, senderId, senderType (user|agent)
  ├─ type (text|agent_response|system)
  ├─ content, chunks (JSON), mentions (JSON)
  └─ replyToId, attachments

agents
  ├─ id, name, type, status
  ├─ gatewayId, connectionType (cli|api)
  └─ workingDirectory, capabilities (JSON)

routers
  ├─ id, name, scope (personal|global)
  ├─ llmBaseUrl, llmApiKey (encrypted), llmModel
  ├─ maxChainDepth, rateLimitWindow, rateLimitMax
  └─ visibility, visibilityList (JSON)

refresh_tokens
  ├─ id, userId, tokenHash (argon2)
  └─ expiresAt, createdAt
```

## State Management (Frontend)

The web app uses Zustand stores with clear separation of concerns:

| Store | Responsibility |
|-------|----------------|
| `useAuthStore` | JWT tokens, user session, login/logout |
| `useChatStore` | Rooms, messages, streaming chunks, unread counts |
| `useAgentStore` | Agent list, status, online tracking |
| `useTaskStore` | Task CRUD |
| `useWebSocketStore` | WS connection state, reconnection logic |

WebSocket messages are routed from `useWebSocketStore` to the appropriate stores via event handlers.

## Configuration

All configuration is sourced from environment variables. See [`.env.example`](../.env.example) for the full reference.

Critical variables required at startup (server will exit with code 1 if missing in production):
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET` (min 32 chars)
- `ENCRYPTION_KEY` (min 32 chars)
- `ADMIN_PASSWORD`
- `CORS_ORIGIN` (must be exact origin, not `*`)

## Deployment Topology

```
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                    HTTPS/WSS
                    ┌──────▼──────┐
              ┌─────│  Reverse    │─────┐
              │     │  Proxy      │     │
              │     │  (Nginx /   │     │
              │     │   Caddy /   │     │
              │     │   Traefik)  │     │
              │     └─────────────┘     │
              │                         │
   ┌──────────▼──────────┐   ┌─────────▼────────┐
   │   AgentIM Server    │   │    Static Assets  │
   │   (Node.js)         │   │    (CDN optional) │
   │   :3000             │   └──────────────────┘
   └──────────┬──────────┘
              │
   ┌──────────▼──────────┐   ┌──────────────────┐
   │    PostgreSQL 16     │   │    Redis 7        │
   │    :5432             │   │    :6379          │
   └─────────────────────┘   └──────────────────┘
```

For Docker Compose, Railway, Render, or Northflank deployment instructions, see [`DEPLOYMENT.md`](./DEPLOYMENT.md).
