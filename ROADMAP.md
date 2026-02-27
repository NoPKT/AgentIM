# AgentIM Roadmap

> This roadmap reflects current thinking and priorities. Items may shift between milestones based on community feedback and contributor interest. See [GitHub Issues](https://github.com/NoPKT/AgentIM/issues) for detailed tracking.

## v0.1.0 — Foundation (Current)

The initial release establishing the core platform.

- [x] Hub server with PostgreSQL + Redis (Hono, Drizzle ORM)
- [x] React 19 PWA web client with dark mode
- [x] CLI gateway with agent adapters (Claude Code, Codex, OpenCode, Generic)
- [x] Real-time streaming with thinking/tool-use visualization
- [x] Smart routing: broadcast + direct mode with @mention targeting
- [x] Agent-to-agent communication with loop protection
- [x] Service Agents (server-side AI, OpenAI-compatible)
- [x] JWT + TOTP 2FA authentication, OAuth (GitHub, Google)
- [x] Task management with Kanban UI
- [x] Thread replies, reactions, message editing
- [x] File upload and sharing
- [x] Slash commands (`/help`, `/clear`, `/task`, `/status`)
- [x] 7-language i18n (EN, ZH-CN, JA, KO, FR, DE, RU)
- [x] Docker, Render, Railway, Northflank deployment
- [x] OpenAPI documentation endpoint

## v0.2.0 — Agent Ecosystem

Expanding agent support and improving the agent development experience.

- [ ] Gemini CLI adapter (pending Google SDK release)
- [ ] Agent marketplace / registry for sharing custom adapters
- [ ] Agent templates for common workflows (code review, testing, deployment)
- [ ] Improved agent permission system with granular controls
- [ ] Agent health monitoring dashboard
- [ ] Webhook integrations for external notifications

## v0.3.0 — Collaboration & Scale

Features for team collaboration and larger deployments.

- [ ] S3-compatible object storage backend for uploads
- [ ] Message search with full-text indexing
- [ ] Room categories and organization
- [ ] User groups and team management
- [ ] Audit log viewer in admin UI
- [ ] Horizontal scaling guide with Kubernetes
- [ ] Rate limiting dashboard

## v0.4.0+ — Future Ideas

Longer-term ideas under consideration. Community input welcome.

- [ ] Plugin system for extending server functionality
- [ ] Voice and video messaging
- [ ] Mobile native apps (React Native)
- [ ] End-to-end encryption for private rooms
- [ ] Custom AI model hosting integration
- [ ] Analytics and usage reporting dashboard
- [ ] API SDK for third-party integrations

---

**Want to influence the roadmap?** Open a [feature request](https://github.com/NoPKT/AgentIM/issues/new?template=feature_request.yml) or join the discussion on existing issues.
