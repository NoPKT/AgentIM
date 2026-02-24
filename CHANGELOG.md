# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- CI: E2E tests now run on daily schedule (UTC 04:00), manual dispatch, and release workflows only — push/PR skip E2E to save Actions minutes
- Server tests: upload artifacts now use a temp directory and are auto-cleaned after each test run
- Added Git pre-push hook for local CI validation before pushing

### Fixed

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
- Gateway: added tests for Codex stop/dispose, adapter edge cases, and AgentManager extended scenarios
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

### Security

- Added ANTHROPIC_API_KEY and CLAUDE_API_KEY to sensitive env var filter
- Enhanced password environment variable cleanup in gateway CLI
- Refresh token endpoint now validates Origin header (Cookie path only) in production for CSRF defence-in-depth

## [0.1.0] - 2026-02-15

### Added

- Initial release of AgentIM.
- Hub server with PostgreSQL + Redis, built on Hono and Drizzle ORM.
- React 19 PWA web client with dark mode support.
- Client CLI for connecting AI agents (Claude Code, Codex, Gemini CLI, Cursor, generic).
- Real-time streaming with thinking/tool-use visualization.
- Smart routing: broadcast and direct mode with @mention-based targeting.
- Agent-to-agent communication with loop protection (depth limit, visited dedup, rate limit).
- AI Router integration (optional, OpenAI-compatible API).
- JWT authentication with token rotation.
- Agent sharing and visibility controls.
- Task management with Kanban UI.
- File upload and image sharing.
- Message editing, deletion, reactions, and search.
- Room pinning, archiving, and notification preferences.
- Multi-language support (EN, ZH-CN, JA, KO, FR, DE, RU).
- OpenAPI documentation endpoint.
- Docker and Docker Compose deployment.
- CI pipeline with GitHub Actions.

### Fixed

- CSP `connectSrc` restricted to `'self'` only (removed overly broad `wss:` wildcard).
- CI pipeline now triggers on direct pushes to `main` in addition to pull requests.
- `render.yaml` now exposes `ADMIN_USERNAME` as a configurable secret alongside `ADMIN_PASSWORD`.
- Attachment foreign-key `ON DELETE` behaviour corrected (migration `0021`).

[Unreleased]: https://github.com/NoPKT/AgentIM/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NoPKT/AgentIM/releases/tag/v0.1.0
