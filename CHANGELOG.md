# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- Docker and Docker Compose deployment
- CI pipeline with GitHub Actions
- **Multi-vendor Service Agent Adapter Architecture**: Pluggable provider system supporting 7 AI providers across chat, search, image, audio, video, music, and 3D categories
  - Provider registry with auto-registration and category-based lookup
  - Async task polling manager for long-running generation tasks (video, 3D, music)
  - Media download and storage pipeline (external URL → storage adapter → internal URL)
  - Zod-to-JSON-Schema conversion for dynamic frontend config forms
  - 7 built-in providers: OpenAI Chat, Perplexity Search, OpenAI Image, ElevenLabs TTS, Runway Video, Stability Audio, Meshy 3D
  - GET `/api/service-agents/providers` endpoint returning available provider metadata and config schemas
  - POST `/api/service-agents/:id/validate` endpoint for config connectivity check
  - Dynamic ServiceAgentsPage with provider-grouped creation form
  - MediaMessage component for inline audio/video/image/3D rendering
  - Database migration `0029_service_agents_category.sql` adding category column
- **Service Agents**: Server-side AI service agent framework with OpenAI-compatible API support, CRUD management (admin), @mention trigger, and encrypted config storage
- **Thread API**: GET `/messages/:messageId/thread` and `/messages/:messageId/replies/count` endpoints for message thread support
- **Thread UI**: ThreadView component for viewing and navigating message reply chains
- **Slash Commands**: Built-in `/clear`, `/help`, `/task`, `/status` commands with popup menu in message input
- **Service Agent Management UI**: Admin page for creating, configuring, and managing service agents
- **Message Edit History API**: GET `/messages/:messageId/edits` endpoint
- **Agent Offline Feedback**: System message broadcast when agents are unreachable
- **PWA Offline Page**: Static offline fallback page for PWA
- **Database migration**: `0028_add_service_agents.sql` for service_agents table

### Changed

- CI: E2E tests now run on daily schedule (UTC 04:00), manual dispatch, and release workflows only — push/PR skip E2E to save Actions minutes
- Server tests: upload artifacts now use a temp directory and are auto-cleaned after each test run
- Added Git pre-push hook for local CI validation before pushing
- **Web client constants**: Migrated hardcoded constants (MAX_WS_QUEUE_SIZE, MAX_CACHED_MESSAGES, etc.) to `@agentim/shared`
- **Date formatting**: Replaced hardcoded `timeAgo()` with `Intl.RelativeTimeFormat` for proper i18n
- **API auth retry**: Extracted `withAuthRetry()` shared function to deduplicate 401 handling in `request()` and `uploadFile()`
- **IndexedDB timeout**: Added 5-second timeout wrapper for all IDB operations
- **WS queue overflow notification**: Dispatches `ws:queue_full` CustomEvent and shows toast notification
- **i18n**: Added `serviceAgent`, `thread`, `slashCommand`, `ws` namespaces to all 7 language files; added provider/category translations for all 7 new providers
- **Accessibility**: Added ARIA labels, roles, and keyboard navigation to message actions, reaction panel, mention menu, and mobile sidebar (aria-modal, auto-focus)
- **Service Agent handler**: Refactored from hardcoded OpenAI logic to provider-based dispatch supporting text, media, and async results
- **Service Agent validators**: Config changed from fixed schema to generic `z.record()` validated per-provider on server side
- **Service Agent types**: Extended `SERVICE_AGENT_TYPES` from 2 to 8 values; added `SERVICE_AGENT_CATEGORIES`; added `category` field to `ServiceAgent` interface
- **Store reset**: Extracted `resetAllStores()` into separate module with dynamic imports to avoid circular dependencies
- **Logout dedup**: Replaced boolean flag with shared Promise to prevent duplicate logout calls

### Fixed

- **[CRITICAL] VAPID private key encryption**: `setSetting()` now encrypts sensitive values before DB storage; `getSetting()` and `preloadSettings()` decrypt on read
- **[CRITICAL] Stream total size limit**: Cumulative 10MB limit on streaming messages prevents memory abuse from infinite chunks
- **[CRITICAL] Agent command permission feedback**: `routeToAgents()` now returns PERMISSION_DENIED error instead of silent failure
- CSP `connectSrc` restricted to `'self'` only (removed overly broad `wss:` wildcard)
- CI pipeline now triggers on direct pushes to `main` in addition to pull requests
- `render.yaml` now exposes `ADMIN_USERNAME` as a configurable secret alongside `ADMIN_PASSWORD`
- Attachment foreign-key `ON DELETE` behaviour corrected (migration `0021`)
- **Gateway Gemini command**: Simplified to "coming soon" placeholder, removed dead daemon/wrapper code
- **Daemon log rotation race condition**: Uses O_EXCL file lock for atomic rotation
- **Custom adapter cache**: Added 30-second TTL to prevent stale adapter data
- **WS queue overflow logging**: Every dropped message now logged; critical message types logged at error level
- **Markdown sanitize regex**: Tightened hljs className pattern from `/^hljs[a-zA-Z0-9_-]*$/` to `/^hljs-[a-z0-9-]{1,30}$/`
- Web: WsClient offline handler now proactively closes WebSocket to ensure immediate reconnection on network recovery
- Gateway: Codex adapter `stop()` now resets running state and discards thread to interrupt execution
- Gateway: `isAgentimProcess` returns false on verification failure (prevents killing recycled PIDs)
- Server: health check endpoint cached for 5 seconds to reduce DB/Redis probe frequency
- Server: error handler status code restricted to valid 400–599 range (prevents leaking internal codes)
- Server: audit log metadata truncated at 4KB to prevent DB row bloat
- Server: added `auth` to logger sensitive key redaction list (Web Push auth tokens)
- Web: fixed @mention menu not closing after space — now validates mention pattern before showing
- Web: offline message dedup now compares mentions, attachments, and replyTo in addition to content
- Shared: unified `hasMention` boundary matching to be consistent with `parseMentions` regex
- Server: added unit tests for crypto (round-trip, wrong key), sanitize (XSS patterns), and token revocation
- Gateway: added tests for Codex stop/dispose, adapter edge cases, AgentManager extended scenarios, custom adapters, and daemon manager
- Replace hardcoded enums with constants in validators (ASSIGNEE_TYPES, NOTIFICATION_PREFS, MEMBER_TYPES)
- Add missing User and Gateway validation schemas
- Redis rate limiter fail-open with in-memory fallback instead of 503
- Token revocation check fail-open with warning log instead of fail-closed
- Enhanced SSRF protection with additional private IP ranges (multicast, broadcast, CGNAT)
- Improved HTML sanitization with entity decoding before tag stripping
- Optimized body limit middleware with pre-created instances
- Fixed potential race condition in agent-manager message callbacks
- Gateway CLI: unified console output to structured logger
- Gateway: configurable WebSocket reconnect attempts via AGENTIM_MAX_RECONNECT
- Gateway adapters: extracted common spawn-and-stream logic to base class
- Web: stricter CSS class name regex in markdown sanitizer
- Web: queue-full notification via CustomEvent for UI awareness
- Added sensitive file patterns to .gitignore (_.pem, _.key, \*.p12)
- Enhanced ENCRYPTION_KEY validation (32+ chars required in production)
- Extracted duplicate Redis Lua rate-limit script to shared constant in redis.ts
- Corrected misleading JSDoc on revokeUserTokens explaining the intentional fail-open/fail-closed asymmetry
- Added explanatory comment on SHA-256 key derivation in crypto.ts (high-entropy key, no KDF needed)
- Web test suite now included in root CI pipeline and turbo task graph
- Added publishConfig to gateway package.json for npm publishing
- WebP magic byte validation now also checks VP8 chunk identifier (VP8 /VP8L/VP8X)
- Added i18n translation completeness test to shared test suite
- Increased displayName max length from 50 to 100 characters (independent from username limit)
- Centralized LLM router timeout config into config.ts (ROUTER_LLM_TIMEOUT_MS)
- Strengthened Redis production warning with security impact details
- Updated MIGRATION_ROLLBACK.md to cover rollback scripts 0019–0026
- Added missing rollback scripts for migrations 0024–0026
- Gateway CLI: Gemini command now indicates "coming soon — SDK not yet published" in help text
- Docker Compose: added TRUST_PROXY environment variable pass-through
- Admin dashboard: shows Redis connection warning banner when Redis is disabled
- Admin metrics API: exposes `infrastructure.redisEnabled` status
- Fixed `MAX_MESSAGES_PER_ROOM_CACHE_CACHE` typo in message-cache import
- Web: added message-cache, slash-commands, ws queue overflow, chat thread/streaming tests

### Security

- Added ANTHROPIC_API_KEY and CLAUDE_API_KEY to sensitive env var filter
- Enhanced password environment variable cleanup in gateway CLI
- Refresh token endpoint now validates Origin header (Cookie path only) in production for CSRF defence-in-depth
