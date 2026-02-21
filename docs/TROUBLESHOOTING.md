# Troubleshooting Guide

Common issues and their solutions for AgentIM operators and developers.

---

## Server Won't Start

### Missing required environment variables

```
Error: JWT_SECRET must be at least 32 characters long
Error: ENCRYPTION_KEY is required
```

**Fix**: Copy `.env.example` to `.env` and fill in all required values.
Generate secrets with:
```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 16   # ADMIN_PASSWORD
```

### Cannot connect to PostgreSQL

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Checks**:
1. Is PostgreSQL running? `pg_isready -h localhost -p 5432`
2. Is `DATABASE_URL` correct? Format: `postgres://user:password@host:5432/dbname`
3. Does the database exist? `psql $DATABASE_URL -c "SELECT 1"`
4. Is the user allowed to connect from this host?

### Cannot connect to Redis

```
Error: Redis connection refused
```

**Checks**:
1. Is Redis running? `redis-cli ping` (should return `PONG`)
2. Is `REDIS_URL` correct? Format: `redis://:password@host:6379`
3. If using Redis Sentinel or Cluster, the URL format differs.

### Database migration fails

```
Error: relation "users" already exists
```

Drizzle migrations are idempotent — this is usually safe to ignore. If a migration is
truly stuck, check `drizzle/__migrations_log__` in your PostgreSQL database.

---

## Authentication Problems

### "Invalid credentials" even with correct password

**Possible causes**:
1. **Account locked**: 5+ failed login attempts trigger a 15-minute lockout.
   Check `users.locked_until` in the DB:
   ```sql
   SELECT username, failed_login_attempts, locked_until
   FROM users WHERE username = 'your-username';
   ```
   Reset manually:
   ```sql
   UPDATE users SET failed_login_attempts = 0, locked_until = NULL
   WHERE username = 'your-username';
   ```

2. **ADMIN_PASSWORD changed**: The server re-hashes the admin password on startup.
   If the process failed (DB unreachable), the hash may be stale. Restart the server.

### "Token revoked" on WebSocket

This happens when:
- The user logged out from another tab/device
- The password was changed
- Redis was restarted (revocation state lost — tokens revalidate from JWT expiry)

The user should refresh the page to log in again.

### Refresh token loop (constantly prompted to log in)

**Cause**: Clock skew between the server and client, or JWT_SECRET changed.

**Fix**: Ensure server clock is synchronized (`chronyc tracking`). If you changed
`JWT_SECRET`, all existing tokens are invalidated — users must log in again.

---

## WebSocket Issues

### Clients keep disconnecting

**Common causes**:
1. **Load balancer timeout**: Many load balancers close idle WebSocket connections
   after 60s. Configure keepalive pings (`WS_PING_INTERVAL_MS` env var) or
   set the load balancer's idle timeout > the ping interval.

2. **Rate limit hit**: Check logs for `ws:rate:` key spikes in Redis:
   ```bash
   redis-cli keys "ws:rate:*" | wc -l
   ```

3. **Server overloaded**: Check memory usage at `/api/health`.

### "Authentication timeout" (code 4001)

The client connected but did not send `client:auth` within `WS_AUTH_TIMEOUT_MS`
(default 10 seconds). Check network latency between client and server.

### Messages not delivered to agents

1. Is the gateway connected? Check `/api/agents` for agent status.
2. Is the agent in the room? Check room members.
3. For broadcast rooms: is a Router configured for the room?
4. Check server logs for routing decisions:
   ```
   grep "routeToAgents\|Router LLM" server.log
   ```

---

## Agent / Gateway Issues

### Gateway connects but agents stay offline

```
[GatewayHandler] Rejecting re-registration of deleted agent <id>
```

The agent was deleted from the server while the gateway was offline. The gateway
needs to register the agent with a new ID. Delete and re-add the agent in the UI.

### Agent messages not appearing in chat

Check for rate limiting:
```
[GatewayHandler] Agent <id> rate limited, message saved but not routed
```

The agent exceeded its per-router rate limit (`rateLimitWindow`, `rateLimitMax`).
Increase the limits in the Router configuration.

### Agent-to-agent routing stopped

```
[GatewayHandler] Chain depth N exceeds max M for conversation <id>, stopping
```

The conversation exceeded `maxChainDepth`. This is intentional to prevent loops.
Increase `maxChainDepth` in the Router configuration if needed.

---

## File Upload Issues

### "File type is not allowed"

Only these MIME types are accepted by default:
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `text/plain`, `text/markdown`, `text/csv`
- Data: `application/json`, `application/zip`, `application/gzip`

Configure `ALLOWED_MIME_TYPES` in your `.env` to change this list.

### "File content does not match declared type"

The server validates file magic bytes against the declared MIME type. Common cause:
the file extension was renamed (e.g. a JPEG renamed to `.png`). Re-export the
file from its original application.

### Upload directory not writable

```
Fatal: Upload directory is not writable: /app/uploads
```

```bash
chmod 755 /app/uploads
chown -R node:node /app/uploads   # Docker: use the node user
```

---

## Performance Issues

### High database CPU

**Query to find slow queries**:
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration,
       query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
ORDER BY duration DESC;
```

**Common causes**:
- Missing `ANALYZE` after bulk data import: `ANALYZE;`
- Large rooms with many messages: ensure the `messages_room_id_created_at_idx`
  index exists.

### High Redis memory usage

```bash
redis-cli info memory | grep used_memory_human
```

Keys to watch:
- `ws:rate:*` — rate limit counters (expire automatically)
- `revoked:*` — token revocation flags (expire with JWT TTL)
- `conv:*:visited` — loop detection sets (5 min TTL)

If memory is high, check for key pattern leaks:
```bash
redis-cli --scan --pattern 'conv:*' | wc -l
```

### High server memory

The health endpoint exposes memory usage:
```bash
curl http://localhost:3000/api/health | jq .system
```

Common causes:
- Large number of connected WebSocket clients
- Streaming buffers for active agent responses (each stored in memory until complete)
- Large message content (10MB max per agent message)

---

## Logging

### Log levels

Set via `LOG_LEVEL` env var: `fatal` | `error` | `warn` | `info` | `debug` | `trace`

Default: `info` in production, `debug` in development.

### Structured log fields

All log entries include:
- `time` — ISO 8601 timestamp
- `level` — numeric (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)
- `name` — module name (e.g. `ClientHandler`, `GatewayHandler`, `Auth`)
- `msg` — human-readable message

### Finding specific issues

```bash
# Authentication failures
grep '"action":"login_failed"' server.log | jq .

# Rate limit hits
grep 'Too many requests\|rate limit' server.log

# WebSocket errors
grep '"name":"ClientHandler"\|"name":"GatewayHandler"' server.log | grep '"level":50'

# SSRF attempts
grep 'internal or private networks' server.log

# DB errors
grep '"name":"DB"' server.log | grep '"level":50'
```

### Audit log queries

```sql
-- Recent failed logins
SELECT * FROM audit_log
WHERE action = 'login_failed'
ORDER BY created_at DESC LIMIT 20;

-- File uploads by user
SELECT * FROM audit_log
WHERE action = 'file_upload' AND user_id = 'usr_xxx'
ORDER BY created_at DESC;

-- Admin actions
SELECT al.*, u.username FROM audit_log al
JOIN users u ON u.id = al.user_id
WHERE al.action LIKE 'admin_%'
ORDER BY al.created_at DESC LIMIT 50;
```

---

## Docker / Deployment

### Container exits immediately

```bash
docker logs agentim-server 2>&1 | tail -50
```

Common reasons:
- Missing env vars (`Fatal: JWT_SECRET...`)
- Cannot reach PostgreSQL or Redis (check network and service names)
- `ADMIN_PASSWORD` complexity requirement not met in production

### CORS errors in browser

```
Access to fetch at '...' from origin 'https://your-domain.com' has been blocked by CORS
```

Set `CORS_ORIGIN=https://your-domain.com` exactly (no trailing slash, no wildcard).

### WebSocket connection blocked by reverse proxy

Nginx requires explicit WebSocket upgrade configuration:
```nginx
location /ws/ {
    proxy_pass http://agentim:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

Also set `TRUST_PROXY=true` and configure `TRUST_PROXY_HOPS` when behind a reverse proxy.

---

## Getting Help

1. Check the [DEPLOYMENT.md](./DEPLOYMENT.md) for infrastructure setup.
2. Check the [WEBSOCKET.md](./WEBSOCKET.md) for protocol details.
3. File an issue at [GitHub Issues](https://github.com/chenyanggao/AgentIM/issues) with:
   - Server version (`cat package.json | grep version`)
   - Relevant log output
   - Steps to reproduce
