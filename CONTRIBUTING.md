# Contributing to AgentIM

Thank you for your interest in contributing to AgentIM. This guide covers the process for setting up your development environment, making changes, and submitting pull requests.

## Development Environment

### Prerequisites

- Node.js 24+
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

### IDE Setup

**VS Code** (recommended):

- Install the [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) extensions
- The project includes `.vscode/settings.json` with format-on-save configuration
- TypeScript strict mode is enforced — the editor will show type errors inline

**Other editors**: Ensure your editor respects the `.prettierrc` and `tsconfig.json` files in the repository root. Run `pnpm build` periodically to catch cross-package type errors.

### Architecture Overview

```text
packages/
  shared/    — Types, WebSocket protocol, Zod validators, i18n (7 languages)
               Imported by all other packages as @agentim/shared
  server/    — Hono HTTP + WebSocket hub, Drizzle ORM, PostgreSQL + Redis
               Handles auth, rooms, messages, routing, file uploads
  gateway/   — CLI tool (agentim) that spawns AI agents as child processes
               Adapters: Claude Code, Codex, OpenCode, Generic
  web/       — React 19 SPA/PWA, Vite, TailwindCSS v4, Zustand state
               Connects to server via WebSocket for real-time updates
```

**Data flow**: Web UI ↔ (WebSocket) ↔ Hub Server ↔ (WebSocket) ↔ Gateway CLI ↔ (child_process) ↔ AI Agent

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

```text
feat: add agent heartbeat monitoring
fix: resolve WebSocket reconnection loop
docs: update client CLI usage instructions
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

## Testing

### Running tests

```bash
pnpm test             # Run all tests across all packages
pnpm --filter @agentim/server test    # Server tests only
pnpm --filter @agentim/shared test    # Shared package tests only
pnpm --filter agentim test            # Gateway tests only
```

### End-to-End (E2E) Tests

E2E tests use [Playwright](https://playwright.dev/) and require a running server instance:

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium

# Start the server in one terminal
pnpm dev

# Run E2E tests in another terminal
pnpm --filter @agentim/web test:e2e

# Run a specific spec file
npx playwright test e2e/chat.spec.ts

# Run with UI mode for debugging
npx playwright test --ui
```

E2E tests create temporary users and rooms, so they can run safely against a development database. They do **not** run in the pre-push hook (too slow) — they run in CI on PRs and daily schedules.

### Test framework

Tests use Node.js built-in `node:test` runner with `node:assert/strict`. No external test frameworks.

### Test structure

```text
packages/
  server/test/
    helpers.ts            — Shared utilities (startServer, stopServer, api, connectWs)
    api.test.ts           — REST API integration tests
    ws.test.ts            — WebSocket protocol tests
    routing.test.ts       — Agent message routing tests
    upload.test.ts        — File upload tests
    access-control.test.ts — Permission and role tests
    boundary.test.ts      — Edge case and limit tests
    endpoints.test.ts     — Endpoint coverage tests
  shared/test/
    shared.test.ts        — Validator, i18n, and utility tests
  gateway/test/
    gateway.test.ts       — Adapter and CLI tests
```

### Prerequisites for server tests

Server integration tests require running PostgreSQL and Redis instances:

```bash
# Default test connections (override with env vars)
TEST_PG_URL=postgresql://postgres:postgres@localhost:5432
TEST_REDIS_URL=redis://localhost:6379/1
```

Each test run creates a temporary database (`agentim_test_<timestamp>`) and cleans it up afterward. Tests use Redis DB 1 (not DB 0) to avoid interfering with development data.

### Writing tests

```typescript
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, registerUser } from './helpers.js'

describe('My Feature', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  it('does the right thing', async () => {
    const user = await registerUser('testuser')
    const res = await api('GET', '/api/rooms', undefined, user.accessToken)
    assert.equal(res.status, 200)
    assert.equal(res.data.ok, true)
  })
})
```

Key helpers from `test/helpers.ts`:

- `startServer()` / `stopServer()` — Spin up a real server with a temporary database
- `api(method, path, body?, token?)` — HTTP helper returning `{ status, data }`
- `registerUser(username)` — Create a user and return their tokens
- `connectWs(url)` — Open a WebSocket connection
- `wsSendAndWait(ws, msg, expectedType)` — Send a WS message and wait for a response

### Test conventions

- Each test file should be self-contained — call `startServer()` in `before` and `stopServer()` in `after`
- Use descriptive test names that explain the expected behavior
- Test both success and failure cases (invalid input, unauthorized access, etc.)
- For WebSocket tests, use `wsSendAndWait()` to avoid timing issues

## Internationalization (i18n)

All user-facing strings must use i18next translation keys. When adding or modifying UI text, you must update all seven locale files:

- `packages/shared/src/i18n/locales/en.ts`
- `packages/shared/src/i18n/locales/zh-CN.ts`
- `packages/shared/src/i18n/locales/ja.ts`
- `packages/shared/src/i18n/locales/ko.ts`
- `packages/shared/src/i18n/locales/fr.ts`
- `packages/shared/src/i18n/locales/de.ts`
- `packages/shared/src/i18n/locales/ru.ts`

Pull requests with missing locale updates will not be merged.

## Getting Help

- **Bug reports**: Use the [bug report template](https://github.com/NoPKT/AgentIM/issues/new?template=bug_report.yml)
- **Feature requests**: Use the [feature request template](https://github.com/NoPKT/AgentIM/issues/new?template=feature_request.yml)
- **Questions**: Open a [GitHub Discussion](https://github.com/NoPKT/AgentIM/discussions) or file an issue
- **Documentation**: See [docs/](docs/) for deployment, WebSocket protocol, adapter guide, and troubleshooting

## Release Process

AgentIM follows [Semantic Versioning](https://semver.org/) (0.x.y during pre-1.0 development).

### How releases work

1. **Development**: All changes accumulate under `[Unreleased]` in `CHANGELOG.md`.
2. **Prepare release**: When ready to release, move `[Unreleased]` content into a versioned section (e.g. `[0.1.0] - 2026-02-27`) and update `version` fields in all `package.json` files.
3. **Tag and push**: Create a signed git tag matching the version (`git tag v0.1.0`) and push it (`git push origin v0.1.0`).
4. **CI pipeline**: Pushing a `v*` tag triggers the release workflow which:
   - Runs the full CI pipeline (build, test, E2E)
   - Builds and pushes multi-arch Docker images to GHCR
   - Publishes `@agentim/shared` and `agentim` CLI to npm (via OIDC)
   - Creates a GitHub Release with auto-generated notes
   - Scans the Docker image with Trivy

### Important notes

- **Only maintainers** create git tags and trigger releases.
- **Never** create tags without explicit approval from a maintainer.
- **External deployment templates** (Railway template `9S4Cvc`, Northflank template `6992c4abb87da316695ce04f`) must be manually updated when a release introduces new required environment variables or infrastructure changes. Render (`render.yaml`) and Docker (`docker-compose.yml`) auto-sync with the repository.

## License

By contributing to AgentIM, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
