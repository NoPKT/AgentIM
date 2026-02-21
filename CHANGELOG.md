# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-02-21

### Fixed

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

[0.1.1]: https://github.com/NoPKT/AgentIM/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/NoPKT/AgentIM/releases/tag/v0.1.0
