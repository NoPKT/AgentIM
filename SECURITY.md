# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Please send vulnerability reports to **security@nopkt.com**. Include the following information in your report:

- A description of the vulnerability and its potential impact.
- Steps to reproduce the issue or a proof-of-concept.
- The affected version(s) and component(s) (server, web, gateway, shared).
- Any suggested fixes, if available.

## Response Timeline

- **Acknowledgment**: Within 48 hours of receiving your report.
- **Assessment**: We will evaluate the severity and confirm whether the issue is accepted.
- **Fix**: Critical vulnerabilities will be addressed within 30 days.
- **Disclosure**: A fix will be released before any public disclosure.

## Responsible Disclosure

We ask that you give us a reasonable amount of time to address the issue before disclosing it publicly. We are committed to working with security researchers and will credit reporters in release notes (unless anonymity is requested).

Thank you for helping keep AgentIM and its users safe.

## Deployment Security Checklist

- Set `JWT_SECRET` to a cryptographically random string (min 32 chars): `openssl rand -hex 32`
- Set `ENCRYPTION_KEY` to a strong random string (min 32 chars): `openssl rand -hex 32`
- Set `CORS_ORIGIN` to your exact frontend domain (e.g., `https://app.example.com`)
- Set `TRUST_PROXY=true` only when behind a trusted reverse proxy (nginx, Cloudflare, etc.)
- Use HTTPS in production — set `NODE_ENV=production` to enable secure cookies and HSTS
- Set strong `ADMIN_PASSWORD` meeting complexity requirements (8+ chars, mixed case + digit)
- Regularly rotate `JWT_SECRET` and `ENCRYPTION_KEY` (will invalidate active sessions)
- Monitor `/api/health` endpoint for database, Redis, and filesystem connectivity

## Security Architecture Overview

AgentIM employs a layered defence-in-depth security architecture:

1. **Authentication layer** — JWT dual-token system (short-lived access token + long-lived refresh token) with Argon2id password hashing. Access tokens are HS256-signed JWTs with `iss`/`aud` claims set to `agentim` and unique `jti` (nanoid) per token.
2. **Session layer** — Refresh tokens stored as Argon2id hashes in PostgreSQL, delivered via `httpOnly` / `SameSite=Strict` / `Secure` cookies. Token rotation on every refresh with per-user PostgreSQL advisory locks (`pg_advisory_xact_lock`) to prevent race conditions.
3. **Transport layer** — HSTS (`max-age=15552000; includeSubDomains`) in production, strict CSP, Permissions-Policy blocking camera/microphone/geolocation/payment.
4. **Data-at-rest layer** — AES-256-GCM encryption for sensitive configuration (router API keys). ENCRYPTION_KEY is required in production and validated at startup (min 32 chars).
5. **Network layer** — SSRF protection with private IP detection, DNS rebinding checks, and scheme allowlisting (http/https only). CORS strict origin validation in production (no wildcards).
6. **Input layer** — Server-side Zod validation on all HTTP and WebSocket endpoints. HTML/XSS sanitization strips script, iframe, svg, object, embed, form, and math tags plus inline event handlers and dangerous URL schemes.

## Authentication & Session Management

### Dual-Token Architecture

- **Access token**: Short-lived JWT (default `15m`, configurable via `JWT_ACCESS_EXPIRY`). Stored in-memory only by the web client (never in localStorage/cookies) to mitigate XSS token theft.
- **Refresh token**: Long-lived JWT (default `7d`, configurable via `JWT_REFRESH_EXPIRY`). Delivered to browsers in an `httpOnly` / `SameSite=Strict` cookie scoped to `/api/auth`. Also returned in the JSON body for Gateway CLI clients that cannot use cookies.
- Both tokens include a `type` claim (`access` or `refresh`). The server enforces type checking — refresh tokens cannot be used as access tokens and vice versa.

### Token Structure

All JWTs are HS256-signed with the following registered claims:

- `sub` — user ID
- `iss` / `aud` — both set to `agentim`
- `jti` — unique identifier per token (nanoid), preventing replay across token families
- `iat` — issued-at timestamp, used for revocation checks
- `exp` — expiration time

### Token Rotation

On every `/api/auth/refresh` call:

1. The server acquires a per-user PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtext(userId))`) to serialize concurrent refresh requests.
2. The incoming refresh token is verified against stored Argon2id hashes using sequential comparison with early exit.
3. The matched token is atomically deleted and a new token pair is issued within the same transaction.
4. Per-user refresh token count is capped at `maxRefreshTokensPerUser` (default `10`); oldest tokens are pruned on login.

### CSRF Protection

- Primary: `SameSite=Strict` on the refresh cookie.
- Secondary (defence-in-depth): In production, the `/api/auth/refresh` endpoint validates the `Origin` header against the configured `CORS_ORIGIN` when the cookie path is used.

### Account Lockout

- After `5` consecutive failed login attempts (`LOCKOUT_THRESHOLD`), the account is locked for `15` minutes (`LOCKOUT_DURATION_MS = 15 * 60 * 1000`).
- Failed attempt counter is incremented atomically via SQL (`COALESCE(failed_login_attempts, 0) + 1`) to prevent race conditions.
- Locked accounts return the same `401 Invalid credentials` error as invalid passwords to prevent username enumeration.
- A dummy Argon2id verification is always performed when the user does not exist or is locked, ensuring constant-time responses regardless of account state.

### Session Revocation

- On logout, all refresh tokens for the user are deleted from PostgreSQL, `revokeUserTokens()` is called, and all active WebSocket connections for that user are forcefully closed with code `1008` (Policy Violation).
- Cross-process revocation is propagated via Redis pub/sub with HMAC-SHA256 signed messages (using `JWT_SECRET`), preventing forged revocations from Redis-level attackers.
- Without Redis, revocations are persisted to the `revoked_tokens` database table and checked on each request, with an in-memory cache as fast path.

### Cross-Tab Logout

The web client synchronizes logout across browser tabs via `localStorage` events, ensuring that logging out in one tab immediately invalidates all other tabs.

## Authorization & Access Control

### Role-Based Access Control (RBAC)

- **User roles**: `admin` and `user` (defined in `USER_ROLES`).
- Admin role is verified via `adminMiddleware`, which queries the database with a short-lived in-process cache (15-second TTL, max 500 entries).
- Admin-only endpoints: user management, settings management, admin metrics dashboard.

### Room-Level Permissions

- **Member roles**: `owner`, `admin`, `member` (defined in `MEMBER_ROLES`).
- Room creators automatically have `owner` role.
- Room membership checks are cached in Redis (60-second TTL) with an in-memory fallback.
- The `agentCommandRole` field on rooms controls the minimum role required to invoke agent commands (configurable per room: `member`, `admin`, or `owner`).

### WebSocket Authentication

- Both client (`/ws/client`) and gateway (`/ws/gateway`) WebSocket endpoints enforce a `5`-second authentication timeout (`wsAuthTimeoutMs`). Unauthenticated connections are closed with code `4001`.
- Per-socket brute-force protection: max `5` auth attempts per connection with exponential backoff (base `200ms`).
- WebSocket upgrade requests are rate-limited at `30` per minute per IP (`wsUpgradeRateLimit`).

## Input Validation & Sanitization

### Server-Side Validation

All HTTP and WebSocket endpoints use Zod schemas (defined in `@agentim/shared/validators`) for input validation. Key schemas include:

- `loginSchema`, `registerSchema` — authentication inputs
- `createRoomSchema`, `sendMessageSchema` — room and message operations
- `clientMessageSchema`, `gatewayMessageSchema` — WebSocket protocol messages (discriminated unions)
- `toolInputSchema` — agent tool inputs with size, key count, key length, and prototype pollution checks

### WebSocket Message Limits

| Limit | Value | Source |
| --- | --- | --- |
| Client message size | 128 KB | `WS_CLIENT_MESSAGE_SIZE_LIMIT` |
| Gateway message size | 256 KB | `WS_GATEWAY_MESSAGE_SIZE_LIMIT` |
| JSON nesting depth | 15 levels | `MAX_JSON_DEPTH` |
| Full content size | 200 KB | `MAX_FULL_CONTENT_SIZE` |
| Cumulative stream size | 10 MB | `MAX_STREAM_TOTAL_SIZE` |
| Message content length | 100,000 chars | `MAX_MESSAGE_LENGTH` |

### Prototype Pollution Protection

The `DANGEROUS_KEY_NAMES` constant (`__proto__`, `constructor`, `prototype`) is checked against all top-level keys in `toolInputSchema` and `serviceAgentConfigSchema`. Payloads containing these keys are rejected with a validation error.

### HTML/XSS Sanitization

Server-side sanitization (`packages/server/src/lib/sanitize.ts`) operates in two modes:

- **`stripHtml()`** — Strips ALL HTML tags from short fields (room names, display names).
- **`sanitizeContent()`** — For message content, strips dangerous block-level tags (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<svg>`, `<math>`) and inline event handlers (`on*=`) / dangerous URL schemes (`javascript:`, `vbscript:`, `data:`) within HTML tag syntax. Preserves legitimate markdown and code.

Client-side defence uses `rehype-sanitize` as an additional layer.

### Tool Input Limits

| Limit | Value | Constant |
| --- | --- | --- |
| Max keys per tool input | 100 | `MAX_TOOL_INPUT_KEYS` |
| Max key length | 200 chars | `MAX_TOOL_INPUT_KEY_LENGTH` |
| Max serialized size | 1 MB | `MAX_TOOL_INPUT_SIZE` |

## File Upload Security

### MIME Type Allowlist

Allowed types are defined in `ALLOWED_MIME_TYPES` (`@agentim/shared/constants`):

- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `application/json`
- Archives: `application/zip`, `application/x-zip-compressed`, `application/gzip`

**SVG is intentionally excluded** because SVG files can contain `<script>` tags and event handlers leading to stored XSS.

### Magic Byte Verification

All uploads are validated against known magic byte signatures (`MAGIC_BYTES` in `uploads.ts`). JPEG, PNG, GIF, WebP, PDF, ZIP, and GZIP files must have correct file headers. WebP files are additionally validated for the `WEBP` marker at offset 8 and a valid VP8 chunk identifier at offset 12. Text-based types (`text/plain`, `text/markdown`, `text/csv`, `application/json`) are validated as valid UTF-8 without null bytes.

### Size Limits

- General file upload: `10` MB (`MAX_FILE_SIZE`, configurable via `MAX_FILE_SIZE` env var)
- Avatar upload: `2` MB (`MAX_AVATAR_SIZE`)
- Upload HTTP body limit: `12` MB (`uploadBodyLimit`) to accommodate multipart overhead

### Response Headers for Uploaded Files

All files served from `/uploads/*` include:

- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` — prevents script execution
- `Referrer-Policy: no-referrer` — prevents token leakage via Referer header
- `Content-Disposition: attachment` — forced download for non-safe types (anything other than JPEG/PNG/GIF/WebP)

### Authentication

All upload URLs (`/uploads/*`) are gated behind JWT authentication. The web client appends the current access token as a `?token=` query parameter for browser-initiated image requests. Bearer header authentication is also supported.

## Network & Transport Security

### HTTP Security Headers (Production)

The server uses Hono's `secureHeaders` middleware with the following production configuration:

- **Strict-Transport-Security**: `max-age=15552000; includeSubDomains` (180 days)
- **Content-Security-Policy**:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: blob:`
  - `connect-src 'self'`
  - `object-src 'none'`
  - `frame-ancestors 'none'`
  - `base-uri 'self'`
  - `form-action 'self'`
  - `upgrade-insecure-requests`
- **Permissions-Policy**: camera `()`, microphone `()`, geolocation `()`, payment `()` — all denied

### CORS

- In production, `CORS_ORIGIN` is required and validated at startup. Empty or wildcard (`*`) values cause the server to refuse to start.
- The origin string must be a valid URL with `https://` or `http://` scheme and no path component.
- CORS is dynamically evaluated per-request: the `origin` callback checks against configured allowed origins (supports comma-separated multiple origins via DB settings or env var).
- `credentials: true` is set to allow cookies for refresh token delivery.

### SSRF Protection

The SSRF module (`packages/server/src/lib/ssrf.ts`) provides three layers of protection:

1. **`isInternalUrl()`** — Static analysis of the URL: blocks localhost variants, `0.0.0.0`, cloud metadata (`169.254.169.254`), `.local`/`.internal` hostnames, octal/hex IP notation bypasses, private IP ranges (RFC 1918, RFC 6598 CGNAT, link-local, loopback, multicast, reserved), and non-HTTP schemes.
2. **`isPrivateIp()`** — Checks individual IP addresses against private ranges including IPv4-mapped IPv6 addresses (both dotted and hex notation).
3. **`resolvesToPrivateIp()`** — DNS resolution check with a `5`-second timeout. Resolves A and AAAA records for hostnames and verifies none resolve to private IPs, catching DNS rebinding attacks.

## Rate Limiting

Rate limits are enforced via Redis (INCR + EXPIRE atomic operations) with an in-memory fallback when Redis is unavailable. The in-memory fallback reduces the effective limit by 50% to compensate for per-process multiplication in multi-node deployments.

### HTTP Rate Limits

| Endpoint Category | Limit | Prefix | Identity |
| --- | --- | --- | --- |
| General API | 120 req/min | `api` | IP |
| Login (`/api/auth/login`) | 20 req/min | `auth` | IP |
| Refresh (`/api/auth/refresh`) | 60 req/min | `auth_refresh` | IP |
| Sensitive operations | 5 req/min | `sens` | User ID (fallback: IP) |
| File upload | 10 req/min | `upload` | User ID (fallback: IP) |
| WebSocket upgrade | 30 req/min | `ws_upgrade` | IP |

### WebSocket Rate Limits

| Limit | Default | Config Key |
| --- | --- | --- |
| Client messages per window | 30 msg / 10s | `CLIENT_RATE_LIMIT_MAX` / `CLIENT_RATE_LIMIT_WINDOW` |
| Agent rate limit | 20 msg / 60s | `AGENT_RATE_LIMIT_MAX` / `AGENT_RATE_LIMIT_WINDOW` |

### Connection Limits

| Limit | Default | Config Key |
| --- | --- | --- |
| Max WS connections per user | 10 | `MAX_WS_CONNECTIONS_PER_USER` |
| Max total WS connections | 5,000 | `MAX_TOTAL_WS_CONNECTIONS` |
| Max gateways per user | 20 | `MAX_GATEWAYS_PER_USER` |

Per-user connection limits can be overridden per user via the admin API (`maxWsConnections`, `maxGateways` fields).

## Monitoring & Audit

### Audit Log

Security-relevant events are recorded in the `audit_logs` PostgreSQL table. Tracked actions include:

`login`, `login_failed`, `logout`, `password_change`, `user_create`, `user_update`, `user_delete`, `router_create`, `router_update`, `router_delete`, `room_create`, `room_update`, `room_delete`, `member_add`, `member_remove`, `file_upload`, `file_delete`, `message_edit`, `message_delete`, `setting_update`

Each entry includes: user ID, action, target ID/type, metadata (capped at 4 KB), client IP address, and timestamp.

### Retention

Audit log retention is configurable via `AUDIT_LOG_RETENTION_DAYS` (default `90` days). Entries older than the retention window are purged on a periodic interval (default every 24 hours, configurable via `AUDIT_LOG_CLEANUP_INTERVAL`).

### Prometheus Metrics

The `/api/metrics` endpoint exposes Prometheus-compatible metrics:

- `agentim_ws_client_connections` — active client WebSocket connections
- `agentim_ws_gateway_connections` — active gateway WebSocket connections
- `agentim_online_users` — users with at least one active connection
- `agentim_connected_agents` — agents registered via active gateways
- `agentim_active_rooms` — rooms with at least one connected client
- `agentim_messages_total` — total messages processed
- `agentim_api_errors_total` — total 5xx API errors
- `agentim_agent_response_duration_seconds` — agent response duration histogram
- `agentim_http_request_duration_seconds` — HTTP request duration histogram
- `process_heap_bytes`, `process_rss_bytes`, `process_uptime_seconds`

In production, `/api/metrics` requires a valid JWT by default (`METRICS_AUTH_ENABLED` defaults to `true`). Set `METRICS_AUTH_ENABLED=false` to allow unauthenticated Prometheus scrapes.

### Sentry Integration

Error tracking via Sentry is supported when `SENTRY_DSN` is configured. Unhandled exceptions and rejected promises are captured automatically.

### Static Analysis

- **CodeQL**: Runs on every push to `main`, on pull requests, and on a weekly schedule (Monday 08:00 UTC). Configured with `security-and-quality` queries for `javascript-typescript`.
- **Trivy**: Docker image vulnerability scanning (CRITICAL, HIGH, MEDIUM) runs as part of the release workflow. Results are uploaded as SARIF to GitHub Security.

## Cryptographic Practices

### Password Hashing

- **Algorithm**: Argon2id (via the `argon2` npm package, which uses Node.js default parameters)
- **Dummy hash** for timing-safe comparison: `$argon2id$v=19$m=65536,t=3,p=4$...` — ensures consistent response timing even when the user does not exist, preventing username enumeration via timing side channels.

### Sensitive Configuration Encryption (Server)

- **Algorithm**: AES-256-GCM
- **IV**: 12 random bytes per encryption operation
- **Key derivation**: `ENCRYPTION_KEY` is normalized to 32 bytes via SHA-256 (safe for high-entropy machine-generated keys; config.ts enforces min 32 chars in production).
- **Storage format**: `enc:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>`

### Gateway Token Encryption

- **Algorithm**: AES-256-GCM
- **IV**: 12 random bytes per encryption operation
- **Key derivation**: PBKDF2-SHA256 with `600,000` iterations (OWASP 2023 minimum recommendation), using a fixed application-specific salt (`AgentIM-machine-key-v1-2024`) and machine identifiers (`hostname:username:homedir`).
- **Storage format**: `base64(iv[12] || authTag[16] || ciphertext)`
- **Backward compatibility**: Falls back to legacy SHA-256 key derivation for decryption of tokens encrypted before the PBKDF2 migration.

### Token Revocation Signatures

- **Algorithm**: HMAC-SHA256 using `JWT_SECRET`
- **Purpose**: Prevents forged token-revocation pub/sub messages from an attacker who gains Redis write access but not the application secret.
- **Verification**: Constant-time comparison (byte-by-byte XOR) to prevent timing attacks.

## Known Limitations & Roadmap

### Current Limitations

- **No OAuth/OIDC**: Authentication is username/password only. OAuth 2.0 / OpenID Connect integration is planned for a future release.
- **No Multi-Factor Authentication (MFA)**: There is currently no TOTP, WebAuthn, or SMS-based second factor.
- **No IP Allowlisting**: There is no mechanism to restrict API access to specific IP ranges.
- **Redis recommended but not enforced**: Redis is strongly recommended for production but not required. Without Redis:
  - Token revocation is process-local only (cross-process revocations are stored in PostgreSQL but checked asynchronously).
  - Rate limiting is per-process — effective limits in multi-process deployments are `maxRequests x number_of_processes`.
  - Pub/Sub for multi-node WebSocket sync is unavailable.
- **Single-process rate limiting without Redis**: In-memory rate limiting uses a 50% reduction to partially compensate for per-process multiplication, but it is not a substitute for Redis-backed global rate limiting in production multi-node deployments.

### Planned Improvements

- OAuth 2.0 / OIDC provider support (Google, GitHub, etc.)
- TOTP-based MFA
- IP allowlisting for admin endpoints
- Hardware security key (WebAuthn) support
