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

```text
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

## Testing

### Running tests

```bash
pnpm test             # Run all tests across all packages
pnpm --filter @agentim/server test    # Server tests only
pnpm --filter @agentim/shared test    # Shared package tests only
pnpm --filter agentim test            # Gateway tests only
```

### Test framework

Tests use Node.js built-in `node:test` runner with `node:assert/strict`. No external test frameworks.

### Test structure

```
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

## License

By contributing to AgentIM, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
