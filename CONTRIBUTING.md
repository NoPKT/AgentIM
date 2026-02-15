# Contributing to AgentIM

Thank you for your interest in contributing to AgentIM. This guide covers the process for setting up your development environment, making changes, and submitting pull requests.

## Development Environment

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+
- Redis 7+

### Setup

```bash
git clone https://github.com/NoPKT/AgentIM.git
cd AgentIM
pnpm install
cp .env.example .env   # Edit .env with your database and Redis connection details
pnpm dev
```

## Code Style

- **Formatter**: Prettier (no semicolons, single quotes, trailing commas).
- **Language**: TypeScript in strict mode, ESM only.
- **Imports**: Use `@agentim/shared` for cross-package types.
- **IDs**: Use `nanoid` for generating identifiers.

Do not disable or override these settings in your contributions.

## Branch Naming

Use the following prefixes:

- `feature/*` -- New features or enhancements.
- `fix/*` -- Bug fixes.
- `docs/*` -- Documentation changes.

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` -- A new feature.
- `fix:` -- A bug fix.
- `docs:` -- Documentation only.
- `test:` -- Adding or updating tests.
- `chore:` -- Maintenance tasks (dependencies, CI, tooling).

Examples:

```
feat: add agent heartbeat monitoring
fix: resolve WebSocket reconnection loop
docs: update gateway CLI usage instructions
```

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Make your changes following the code style and conventions above.
3. Ensure the project builds and tests pass:
   ```bash
   pnpm build
   pnpm test
   ```
4. Submit a pull request against `main` with a clear description of your changes.

## Internationalization (i18n)

All user-facing strings must use i18next translation keys. When adding or modifying UI text, you must update all four locale files:

- `packages/shared/src/i18n/locales/en.ts`
- `packages/shared/src/i18n/locales/zh-CN.ts`
- `packages/shared/src/i18n/locales/ja.ts`
- `packages/shared/src/i18n/locales/ko.ts`

Pull requests with missing locale updates will not be merged.

## License

By contributing to AgentIM, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
