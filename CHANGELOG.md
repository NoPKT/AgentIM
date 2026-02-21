# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-15

### Added

- Initial release of AgentIM.
- Hub server with PostgreSQL + Redis, built on Hono and Drizzle ORM.
- React 19 PWA web client with dark mode support.
- Gateway CLI for connecting AI agents (Claude Code, Codex, Gemini CLI, Cursor, generic).
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

[0.1.0]: https://github.com/NoPKT/AgentIM/releases/tag/v0.1.0
