# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Core Platform

- Initial scaffolding of AgentIM
- Hub server with PostgreSQL + Redis, built on Hono and Drizzle ORM
- React 19 PWA web client with dark mode support
- Client CLI for connecting AI agents (Claude Code, Codex, Gemini CLI, Cursor, generic)
- Real-time streaming with thinking/tool-use visualization
- Smart routing: broadcast and direct mode with @mention-based targeting
- Agent-to-agent communication with loop protection (depth limit, visited dedup, rate limit)
- AI Router integration (optional, OpenAI-compatible API)
- JWT authentication with token rotation
- Agent sharing and visibility controls
- Task management with Kanban UI
- File upload and image sharing
- Message editing, deletion, reactions, and search
- Room pinning, archiving, and notification preferences
- Multi-language support (EN, ZH-CN, JA, KO, FR, DE, RU)
- OpenAPI documentation endpoint

#### Service Agents

- **Multi-vendor Service Agent Adapter Architecture**: Pluggable provider system supporting 7 AI providers across chat, search, image, audio, video, music, and 3D categories
  - Provider registry with auto-registration and category-based lookup
  - Async task polling manager for long-running generation tasks (video, 3D, music)
  - Media download and storage pipeline (external URL -> storage adapter -> internal URL)
  - Zod-to-JSON-Schema conversion for dynamic frontend config forms
  - 7 built-in providers: OpenAI Chat, Perplexity Search, OpenAI Image, ElevenLabs TTS, Runway Video, Stability Audio, Meshy 3D
  - GET `/api/service-agents/providers` endpoint returning available provider metadata and config schemas
  - POST `/api/service-agents/:id/validate` endpoint for config connectivity check
  - Dynamic ServiceAgentsPage with provider-grouped creation form
  - MediaMessage component for inline audio/video/image/3D rendering
  - Database migration `0029_service_agents_category.sql` adding category column
- **Service Agents**: Server-side AI service agent framework with OpenAI-compatible API support, CRUD management (admin), @mention trigger, and encrypted config storage
- **Service Agent Management UI**: Admin page for creating, configuring, and managing service agents
- Admin dashboard: shows Redis connection warning banner when Redis is disabled
- Admin metrics API: exposes `infrastructure.redisEnabled` status

#### Threads, Commands & Messages

- **Thread API**: GET `/messages/:messageId/thread` and `/messages/:messageId/replies/count` endpoints for message thread support
- **Thread UI**: ThreadView component for viewing and navigating message reply chains
- **Slash Commands**: Built-in `/clear`, `/help`, `/task`, `/status` commands with popup menu in message input
- **Message Edit History API**: GET `/messages/:messageId/edits` endpoint
- **Agent Offline Feedback**: System message broadcast when agents are unreachable

#### Infrastructure & Deployment

- Docker and Docker Compose deployment
- CI pipeline with GitHub Actions
- Git pre-push hook for local CI validation before pushing
- **PWA Offline Page**: Static offline fallback page for PWA
- Database migration `0028_add_service_agents.sql` for service_agents table
- Rollback scripts for migrations 0024-0026
- Added publishConfig to gateway package.json for npm publishing

#### Tests

- Server: unit tests for crypto (round-trip, wrong key), sanitize (XSS patterns), and token revocation
- Gateway: tests for Codex stop/dispose, adapter edge cases, AgentManager extended scenarios, custom adapters, and daemon manager
- Web: message-cache, slash-commands, ws queue overflow, chat thread/streaming tests
- Shared: i18n translation completeness test
- Web test suite now included in root CI pipeline and turbo task graph

### Changed

#### Server

- Server tests: upload artifacts now use a temp directory and are auto-cleaned after each test run
- **Service Agent handler**: Refactored from hardcoded OpenAI logic to provider-based dispatch supporting text, media, and async results
- **Service Agent validators**: Config changed from fixed schema to generic `z.record()` validated per-provider on server side
- Redis rate limiter fail-open with in-memory fallback instead of 503
- Token revocation check fail-open with warning log instead of fail-closed
- Optimized body limit middleware with pre-created instances
- Extracted duplicate Redis Lua rate-limit script to shared constant in redis.ts
- Centralized LLM router timeout config into config.ts (ROUTER_LLM_TIMEOUT_MS)
- Strengthened Redis production warning with security impact details
- Health check endpoint cached for 5 seconds to reduce DB/Redis probe frequency
- Audit log metadata truncated at 4KB to prevent DB row bloat
- Error handler status code restricted to valid 400-599 range (prevents leaking internal codes)
- Docker Compose: added TRUST_PROXY environment variable pass-through

#### Web

- **Date formatting**: Replaced hardcoded `timeAgo()` with `Intl.RelativeTimeFormat` for proper i18n
- **API auth retry**: Extracted `withAuthRetry()` shared function to deduplicate 401 handling in `request()` and `uploadFile()`
- **IndexedDB timeout**: Added 5-second timeout wrapper for all IDB operations
- **WS queue overflow notification**: Dispatches `ws:queue_full` CustomEvent and shows toast notification
- **Accessibility**: Added ARIA labels, roles, and keyboard navigation to message actions, reaction panel, mention menu, and mobile sidebar (aria-modal, auto-focus)
- **Store reset**: Extracted `resetAllStores()` into separate module with dynamic imports to avoid circular dependencies
- **Logout dedup**: Replaced boolean flag with shared Promise to prevent duplicate logout calls
- Stricter CSS class name regex in markdown sanitizer

#### Gateway

- Gateway CLI: unified console output to structured logger
- Configurable WebSocket reconnect attempts via AGENTIM_MAX_RECONNECT
- Gateway adapters: extracted common spawn-and-stream logic to base class
- Codex adapter `stop()` now resets running state and discards thread to interrupt execution
- `isAgentimProcess` returns false on verification failure (prevents killing recycled PIDs)
- Gemini command now indicates "coming soon -- SDK not yet published" in help text

#### Shared

- **Web client constants**: Migrated hardcoded constants (MAX_WS_QUEUE_SIZE, MAX_CACHED_MESSAGES, etc.) to `@agentim/shared`
- **Service Agent types**: Extended `SERVICE_AGENT_TYPES` from 2 to 8 values; added `SERVICE_AGENT_CATEGORIES`; added `category` field to `ServiceAgent` interface
- Unified `hasMention` boundary matching to be consistent with `parseMentions` regex
- Increased displayName max length from 50 to 100 characters (independent from username limit)
- Replace hardcoded enums with constants in validators (ASSIGNEE_TYPES, NOTIFICATION_PREFS, MEMBER_TYPES)
- Add missing User and Gateway validation schemas

#### CI & Docs

- CI: E2E tests now run on daily schedule (UTC 04:00), manual dispatch, and release workflows only -- push/PR skip E2E to save Actions minutes
- **i18n**: Added `serviceAgent`, `thread`, `slashCommand`, `ws` namespaces to all 7 language files; added provider/category translations for all 7 new providers
- Updated MIGRATION_ROLLBACK.md to cover rollback scripts 0019-0026
- Added sensitive file patterns to .gitignore (*.pem, *.key, *.p12)
- Corrected misleading JSDoc on revokeUserTokens explaining the intentional fail-open/fail-closed asymmetry
- Added explanatory comment on SHA-256 key derivation in crypto.ts (high-entropy key, no KDF needed)

### Fixed

- **[CRITICAL] VAPID private key encryption**: `setSetting()` now encrypts sensitive values before DB storage; `getSetting()` and `preloadSettings()` decrypt on read
- **[CRITICAL] Stream total size limit**: Cumulative 10MB limit on streaming messages prevents memory abuse from infinite chunks
- **[CRITICAL] Agent command permission feedback**: `routeToAgents()` now returns PERMISSION_DENIED error instead of silent failure
- **[CRITICAL] routerLlm.ts JSON extraction**: Replaced greedy regex with bracket-balanced parser to prevent matching across multiple JSON objects
- **Permission queue overflow**: Added 1,000-entry cap to pending permission queue with rejection and gateway notification
- **Avatar URL path traversal**: Tightened regex to disallow nested paths in upload filenames
- **deletedAgentIds unbounded growth**: Added 10,000-entry FIFO cap to prevent memory leak
- CSP `connectSrc` restricted to `'self'` only (removed overly broad `wss:` wildcard)
- CI pipeline now triggers on direct pushes to `main` in addition to pull requests
- `render.yaml` now exposes `ADMIN_USERNAME` as a configurable secret alongside `ADMIN_PASSWORD`
- Attachment foreign-key `ON DELETE` behaviour corrected (migration `0021`)
- Gateway Gemini command: Simplified to "coming soon" placeholder, removed dead daemon/wrapper code
- Daemon log rotation race condition: Uses O_EXCL file lock for atomic rotation
- Custom adapter cache: Added 30-second TTL to prevent stale adapter data
- Markdown sanitize regex: Tightened hljs className pattern from `/^hljs[a-zA-Z0-9_-]*$/` to `/^hljs-[a-z0-9-]{1,30}$/`
- WsClient offline handler now proactively closes WebSocket to ensure immediate reconnection on network recovery
- @mention menu not closing after space -- now validates mention pattern before showing
- Offline message dedup now compares mentions, attachments, and replyTo in addition to content
- Enhanced SSRF protection with additional private IP ranges (multicast, broadcast, CGNAT)
- Improved HTML sanitization with entity decoding before tag stripping
- Fixed potential race condition in agent-manager message callbacks
- Added `auth` to logger sensitive key redaction list (Web Push auth tokens)
- WebP magic byte validation now also checks VP8 chunk identifier (VP8/VP8L/VP8X)
- Fixed `MAX_MESSAGES_PER_ROOM_CACHE_CACHE` typo in message-cache import
- Enhanced ENCRYPTION_KEY validation (32+ chars required in production)

### Security

- Added ANTHROPIC_API_KEY and CLAUDE_API_KEY to sensitive env var filter
- Enhanced password environment variable cleanup in gateway CLI
- Refresh token endpoint now validates Origin header (Cookie path only) in production for CSRF defence-in-depth
