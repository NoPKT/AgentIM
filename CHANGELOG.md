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
- Client CLI for connecting AI agents (Claude Code, Codex, Gemini CLI *(coming soon)*, OpenCode, generic)
- OpenCode adapter with auto-managed server lifecycle, SSE streaming, session persistence, and delta-based text tracking
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
- **GitHub Issue/PR Templates**: Bug report (YAML form), feature request (YAML form), and PR template with checklists
- **Room Members Pagination**: GET `/api/rooms/:id/members` now supports `limit`/`offset` query parameters with total count

#### Tests

- Server: unit tests for crypto (round-trip, wrong key), sanitize (XSS patterns), and token revocation
- Gateway: tests for Codex stop/dispose, adapter edge cases, AgentManager extended scenarios, custom adapters, and daemon manager
- Web: message-cache, slash-commands, ws queue overflow, chat thread/streaming tests
- Web: WsClient unit tests (47 tests, 95%+ coverage on ws.ts)
- Shared: i18n translation completeness test
- Web test suite now included in root CI pipeline and turbo task graph
- Web coverage thresholds raised to 20%/16%/20%/10% (from 15%/15%/15%/9%)

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
- WS client now accumulates dropped message count across reconnections instead of resetting to zero

#### Shared

- **Web client constants**: Migrated hardcoded constants (MAX_WS_QUEUE_SIZE, MAX_CACHED_MESSAGES, etc.) to `@agentim/shared`
- **Service Agent types**: Extended `SERVICE_AGENT_TYPES` from 2 to 8 values; added `SERVICE_AGENT_CATEGORIES`; added `category` field to `ServiceAgent` interface
- Unified `hasMention` boundary matching to be consistent with `parseMentions` regex
- Increased displayName max length from 50 to 100 characters (independent from username limit)
- Replace hardcoded enums with constants in validators (ASSIGNEE_TYPES, NOTIFICATION_PREFS, MEMBER_TYPES)
- Add missing User and Gateway validation schemas
- `I18N_NAMESPACES` now includes all actual namespaces (a11y, ws, pwa, thread, slashCommand, etc.)
- `createServiceAgentSchema` now validates provider-specific required fields (model for OpenAI/Perplexity, voiceId for ElevenLabs)
- Mention regex cache upgraded from FIFO to LRU eviction for better hit rates under high concurrency

#### CI & Docs

- Added `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)

- CI: E2E tests now run on daily schedule (UTC 04:00), manual dispatch, and release workflows only -- push/PR skip E2E to save Actions minutes
- **i18n**: Added `serviceAgent`, `thread`, `slashCommand`, `ws` namespaces to all 7 language files; added provider/category translations for all 7 new providers
- Updated MIGRATION_ROLLBACK.md to cover rollback scripts 0019-0026
- Added sensitive file patterns to .gitignore (*.pem, *.key, *.p12)
- Corrected misleading JSDoc on revokeUserTokens explaining the intentional fail-open/fail-closed asymmetry
- Added explanatory comment on SHA-256 key derivation in crypto.ts (high-entropy key, no KDF needed)
- Enhanced custom adapter documentation in ADAPTER_GUIDE.md with practical examples (Ollama, Aider, Python script), architecture explanation, and security notes

### Fixed

- **Audit log unbounded growth**: Added periodic cleanup with configurable retention (`AUDIT_LOG_RETENTION_DAYS`, default 90 days) and cleanup interval (`AUDIT_LOG_CLEANUP_INTERVAL`, default 24h)
- **[SECURITY] updateServiceAgentSchema config validation**: Replaced bare `z.record()` with `serviceAgentConfigSchema` to enforce dangerous key name checks on service agent updates (prototype pollution prevention)
- **ServerGatewayMessage missing error type**: Added `serverErrorSchema` to `serverGatewayMessageSchema` so gateways can receive and handle server error messages instead of silently discarding them
- **GatewayPermissionRequest timeoutMs range**: Capped `timeoutMs` validator max at `PERMISSION_TIMEOUT_MS` (300s) instead of hardcoded 600s to match server-side timeout
- **Gateway daemon spawn TOCTOU**: Write PID file reservation before spawning to prevent duplicate agent daemons from concurrent CLI invocations
- **Gateway room context memory leak**: Added 1-hour TTL with periodic cleanup for room context entries to prevent unbounded growth in long-running daemons
- **Gateway PID process verification**: Improved from substring match to argv-based pattern matching to prevent false positives on unrelated processes with "agentim" in their path
- **Gateway WS heartbeat timer**: Added `.unref()` to ping interval timer to allow clean process exit
- **Gateway message queue watermark**: Added warning log at 75% queue capacity before messages start dropping
- **ServiceAgents missing index**: Added `service_agents_created_by_idx` index on `created_by_id` column (migration 0032)
- **PWA offline fallback for WebSocket**: Added `/ws` to `navigateFallbackDenylist` to prevent WS upgrade requests from being served the offline fallback page
- **[CRITICAL] VAPID private key encryption**: `setSetting()` now encrypts sensitive values before DB storage; `getSetting()` and `preloadSettings()` decrypt on read
- **[CRITICAL] Stream total size limit**: Cumulative 10MB limit on streaming messages prevents memory abuse from infinite chunks
- **[CRITICAL] Agent command permission feedback**: `routeToAgents()` now returns PERMISSION_DENIED error instead of silent failure
- **[CRITICAL] routerLlm.ts JSON extraction**: Replaced greedy regex with bracket-balanced parser to prevent matching across multiple JSON objects
- **Permission queue overflow**: Added 1,000-entry cap to pending permission queue with rejection and gateway notification
- **Avatar URL path traversal**: Tightened regex to disallow nested paths in upload filenames
- **Upload filename safety**: Use safe nanoid alphabet (no leading `-`) for stored filenames to match avatarUrl validation regex
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

- Removed inaccurate Cursor references from documentation and GitHub repo description (Cursor adapter was removed; use generic adapter instead)
- Token revocation warning now explicitly calls out multi-process risk when Redis is unavailable
- Rate limiter memory eviction upgraded from single-entry FIFO to batch 10% eviction for efficiency
- Gateway oversized message handling now sends error response back to gateway instead of silently dropping
- Gateway `promptPassword` terminal state now always restored via centralized cleanup (prevents stuck raw mode on interrupt)
- Gateway PBKDF2 iterations increased from 100,000 to 600,000 to meet OWASP minimum recommendation
- Gateway `GenericAdapter` `isAbsolutePath` now correctly detects UNC paths (`\\server\share`)
- Gateway CLI now handles SIGPIPE signal to prevent crash when output is piped to a closed process
- Web draft messages moved from localStorage to sessionStorage (prevents draft leakage on shared devices)
- Web draft auto-save debounce reduced from 1000ms to 500ms for better responsiveness
- Web MarkdownRenderer now sets `skipHtml` to prevent raw HTML passthrough as defense-in-depth
- Gateway `git-utils.ts`: Fixed diff field always being `undefined` in workspace status output
- Gateway `agent-manager.ts`: Fixed unsafe Map mutation during iteration when cleaning room contexts
- **Server test hanging**: Exported cleanup functions for all `setInterval` timers (stream tracker, rate limit, cache, permissions, client/gateway handlers) and call them in shutdown
- **Web accessibility**: ToastContainer now has `role="region"`, `aria-live="polite"`, keyboard-accessible close buttons; ProtectedRoute loading state has `role="status"`; AppLayout nav links have `aria-current="page"`
- **Gateway permission-store timer leak**: Clear old timer when overwriting duplicate `requestId` entries to prevent orphaned timers
- **Gateway permission-store test hanging**: Reduced test timer durations from 10s/100s to 100ms with `.unref()` to prevent event loop blocking
- **Gateway agent-manager timer leak**: Workspace status `Promise.race` timeout timer now cleaned up on completion with `.unref()`
- **Gateway custom-adapters shadowing**: Added validation to prevent custom adapter names from conflicting with built-in adapter types (claude-code, codex, gemini, opencode, generic)
- **Gateway OpenCode permission delivery**: Added retry logic (2 attempts, 500ms backoff) for permission response POST requests
- **Web IndexedDB write resilience**: Added `withIdbRetry()` wrapper with 2 retries and exponential backoff for cache write operations
- **Server missing audit action**: Added `message_edit` audit trail for message edit operations
- **Server migration verification**: Added `verifyMigrations()` check at startup when `RUN_MIGRATIONS=false` to warn about pending migrations
- **Shared validator i18n**: Replaced hardcoded English error messages in Zod `superRefine` with i18n keys across all 7 locales
- **Shared mentions performance**: Added regex compilation cache (500-entry cap) to `hasMention()` to avoid repeated `RegExp` construction
- **Web chat store refactor**: Extracted streaming and presence logic from monolithic `chat.ts` (974 lines) into `chat-streaming.ts` and `chat-presence.ts` helper modules

- **Shared JwtPayload type**: Added optional `iat` and `exp` fields to match the actual JWT claims set by jose during signing
- **Shared isServerGatewayMessage**: Replaced fragile hardcoded type list with a `SERVER_GATEWAY_MESSAGE_TYPES` Set constant for easier maintenance when adding new message types
- **Server SSRF protection**: Extended `isPrivateUrl()` with IPv6 private ranges (fe80::/10 link-local, fc00::/7 ULA, ::ffff:0:0/96 IPv4-mapped), blocks non-HTTP schemes, and blocks the 0.0.0.0/8 range
- **Server settings persistence**: `getSettingSync()` now falls back to last known DB value before env/default, preventing dynamic admin settings from regressing after the 5s cache TTL expires
- **Server auth response**: Login and refresh endpoints no longer expose `refreshToken` in the JSON body for browser clients — the token is delivered exclusively via httpOnly cookie
- **Server migration rollbacks**: Added rollback scripts for migrations 0028–0033 (service_agents, bookmarks, task result/duedate, revoked_tokens)
- **Gateway Codex adapter**: Documented SDK limitation — Codex SDK manages permissions internally and does not expose a callback for relaying through AgentIM's permission system
- **Gateway OpenCode SSE**: Added retry logic (2 attempts, exponential backoff) for SSE subscribe failures during transient network errors
- **Gateway daemon test portability**: Improved temp directory handling with fallback for restricted CI environments
- **Web PageLoader accessibility**: Added `role="status"`, `aria-live="polite"`, and visually-hidden loading text for screen readers
- **Web PWA cache security**: Added `ignoreURLParametersMatching: [/^token$/]` to Workbox config to strip access tokens from service-worker cache keys
- **CI E2E on PRs**: E2E smoke tests (Chromium only) now run on pull requests to catch regressions before merge

### Security

- Added ANTHROPIC_API_KEY and CLAUDE_API_KEY to sensitive env var filter
- Enhanced password environment variable cleanup in gateway CLI
- Refresh token endpoint now validates Origin header (Cookie path only) in production for CSRF defence-in-depth
- Trivy Docker image vulnerability scanning in release workflow with SARIF upload to GitHub CodeQL
- **[SECURITY] CSRF Origin validation consistency**: `/auth/refresh` now uses dynamic CORS config (same source as global CORS middleware) instead of static `config.corsOrigin`, preventing 403 errors when admins change allowed origins at runtime
- **[SECURITY] Push subscription ownership**: `/api/push/unsubscribe` now verifies the subscription belongs to the requesting user, preventing cross-user subscription removal
- **[SECURITY] Health endpoint hardening**: Removed detailed system metrics (memory, uptime) from public `/api/health` endpoint to reduce information surface for unauthenticated scanners
- **[SECURITY] Metrics endpoint auth**: Added optional `METRICS_AUTH_ENABLED` config to require Bearer token for `/api/metrics` (recommended for public deployments)
- **JSON body parse protection**: `serviceAgents` and `push` routes now use `parseJsonBody()` for safe JSON parsing — invalid JSON returns 400 instead of unhandled 500
- **Router LLM circuit breaker**: Added circuit breaker pattern (5 failures → 1min open → half-open probe) to prevent cascading failures when upstream LLM is down
- **Gateway WS queue retry backoff**: Replaced fixed 1s retry delay with exponential backoff (max 5 retries, 1s→16s) to prevent retry storms under high load
- **Gateway exception cleanup**: `uncaughtException` handler now properly awaits cleanup before exiting
- **Audit log field diffing**: Added `diffFields()` utility for enriching audit logs with field-level change details
- **OpenAPI docs accuracy**: Fixed `/auth/refresh` spec to document cookie-based flow (body is optional, not required)
- **E2E assertion fix**: Replaced always-true `>=0` assertion in agents.spec.ts with meaningful `>0` check
- **Web coverage thresholds raised**: lines 23→24, functions 19→21, statements 22→23, branches 11→12; added unit tests for toast and agents stores
- **README**: Added early-stage (v0.x) notice to set user expectations
