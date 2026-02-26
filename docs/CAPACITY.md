# Capacity Planning

Practical guidance for sizing AgentIM deployments. Estimates assume typical usage patterns (chat + streaming agent responses + file sharing).

## Hardware Recommendations

| Users | vCPU | RAM  | Disk   | Notes                               |
| ----- | ---- | ---- | ------ | ----------------------------------- |
| ≤ 10  | 1    | 1 GB | 10 GB  | Single VPS, shared PostgreSQL/Redis |
| ≤ 50  | 2    | 4 GB | 40 GB  | Dedicated DB, moderate file uploads |
| ≤ 200 | 4    | 8 GB | 100 GB | Separate DB server recommended      |

For 200+ users, consider running PostgreSQL and Redis on dedicated instances.

## PostgreSQL Sizing

| Parameter        | ≤ 10 users | ≤ 50 users | ≤ 200 users |
| ---------------- | ---------- | ---------- | ----------- |
| Max connections  | 20         | 50         | 100         |
| `shared_buffers` | 128 MB     | 512 MB     | 1 GB        |
| `work_mem`       | 4 MB       | 8 MB       | 16 MB       |
| Disk (data only) | 1 GB       | 5 GB       | 20 GB       |

Key tuning tips:

- Set `max_connections` slightly above the Hub server's pool size (default: 10).
- Enable `pg_stat_statements` to identify slow queries.
- Schedule periodic `VACUUM ANALYZE` (autovacuum is on by default).
- Message history is the largest table — consider partitioning by `created_at` at scale.

## Redis Memory

| Component            | Per-unit estimate | Notes                       |
| -------------------- | ----------------- | --------------------------- |
| WebSocket session    | ~0.5 KB           | Token + metadata            |
| Room subscription    | ~0.1 KB           | Per user per joined room    |
| Pub/Sub channel      | ~0.2 KB           | Per active room             |
| Typing indicator     | ~0.1 KB           | TTL 4 s, auto-expires       |
| Token revocation set | ~0.1 KB per entry | Grows with logouts, use TTL |

**Rough totals:**

- 10 users, 20 rooms: ~50 KB
- 50 users, 100 rooms: ~500 KB
- 200 users, 500 rooms: ~5 MB

Redis memory usage is minimal. A 64 MB instance is sufficient for most deployments.

## WebSocket Connections

Each browser tab opens one WebSocket connection. Each gateway (CLI) opens one connection.

| Scenario    | Estimated connections | Recommended `ulimit -n` |
| ----------- | --------------------- | ----------------------- |
| ≤ 10 users  | ~20                   | 1024 (default)          |
| ≤ 50 users  | ~100                  | 4096                    |
| ≤ 200 users | ~500                  | 65536                   |

Tuning checklist:

- Increase file descriptor limits: `ulimit -n 65536` (or set in systemd unit).
- Configure reverse proxy (Nginx) timeouts: `proxy_read_timeout 3600s` for long-lived WS.
- Set `proxy_buffering off` for WebSocket routes.
- The Hub server handles heartbeat pings every 30 s; connections idle beyond 90 s are closed.

## File Storage

Uploaded files are stored on local disk by default (configurable via `UPLOAD_DIR`).

| Usage pattern     | Storage estimate per month |
| ----------------- | -------------------------- |
| Light (text-only) | < 100 MB                   |
| Moderate (images) | 1–5 GB                     |
| Heavy (documents) | 5–20 GB                    |

Tips:

- Set `MAX_FILE_SIZE` (default 10 MB) to limit individual uploads.
- Mount a separate volume for `/uploads` to avoid filling the root disk.
- For production, consider an S3-compatible backend with a CDN.

## Monitoring

The server exposes Prometheus metrics at `GET /api/metrics`. In production, authentication is required by default (`METRICS_AUTH_ENABLED` defaults to `true`). Set `METRICS_AUTH_ENABLED=false` to allow unauthenticated Prometheus scrapes.

Available metrics:

- `agentim_ws_client_connections` — active WebSocket clients
- `agentim_ws_gateway_connections` — connected gateways
- `agentim_online_users` — unique online users
- `agentim_connected_agents` — agents registered via active gateways
- `process_uptime_seconds` — server uptime
- `process_heap_bytes` / `process_rss_bytes` — Node.js memory
- `agentim_messages_total` — message counters (by type)
- `agentim_ws_messages_total` — WebSocket message counters (by direction)
- `agentim_api_errors_total` — API error counter
- `agentim_agent_response_duration_seconds` — agent response latency histogram
- `agentim_http_request_duration_seconds` — HTTP request latency histogram
- `agentim_active_rooms` — rooms with at least one connected client

Set alerts on connection counts and memory to detect capacity issues early.
