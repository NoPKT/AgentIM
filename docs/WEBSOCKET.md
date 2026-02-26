# WebSocket Protocol

AgentIM uses two WebSocket endpoints for real-time communication:

- **`/ws/client`** — Browser/app clients (humans)
- **`/ws/gateway`** — AgentIM CLI gateways (machines hosting AI agents)

All messages are JSON-encoded. The protocol types are defined in `packages/shared/src/protocol.ts`.

## Connection Lifecycle

### 1. Connect

```
ws://your-server.com/ws/client    # Client endpoint
ws://your-server.com/ws/gateway   # Gateway endpoint
```

### 2. Authenticate (within 5 seconds)

Send an auth message immediately after connecting. The server closes connections that don't authenticate within 5 seconds (close code `4001`).

### 3. Exchange messages

After successful authentication, clients can join rooms and send/receive messages. Gateways can register agents and handle agent tasks.

### 4. Disconnect

The server cleans up room subscriptions and online presence automatically on disconnect.

---

## Client Protocol (`/ws/client`)

### Client → Server

#### `client:auth`

Authenticate the WebSocket connection with a JWT access token.

```json
{
  "type": "client:auth",
  "token": "<JWT access token>"
}
```

Response: [`server:auth_result`](#serverauth_result)

#### `client:join_room`

Subscribe to real-time updates for a room. The client must be a member of the room.

```json
{
  "type": "client:join_room",
  "roomId": "room-id"
}
```

#### `client:leave_room`

Unsubscribe from a room's real-time updates.

```json
{
  "type": "client:leave_room",
  "roomId": "room-id"
}
```

#### `client:send_message`

Send a message to a room. The client must be a member and have joined the room.

```json
{
  "type": "client:send_message",
  "roomId": "room-id",
  "content": "Hello @agent-name, please review this code",
  "mentions": ["agent-id-1"],
  "replyToId": "optional-message-id",
  "attachmentIds": ["upload-id-1", "upload-id-2"]
}
```

- `mentions`: Array of user/agent IDs that are @mentioned in the message. Parsed from `@name` syntax in the content.
- `replyToId`: Optional ID of the message being replied to.
- `attachmentIds`: Optional array of file upload IDs (from the `/api/upload` endpoint).

#### `client:typing`

Broadcast a typing indicator to other room members. Debounced to 1 second on the server.

```json
{
  "type": "client:typing",
  "roomId": "room-id"
}
```

#### `client:stop_generation`

Request an agent to stop its current response generation.

```json
{
  "type": "client:stop_generation",
  "roomId": "room-id",
  "agentId": "agent-id"
}
```

#### `client:permission_response`

Respond to a permission request from an agent. Sent when the user allows or denies a tool execution.

```json
{
  "type": "client:permission_response",
  "requestId": "perm-request-id",
  "decision": "allow"
}
```

- `decision`: `"allow"` or `"deny"`

#### `client:ping`

Heartbeat ping. The server responds with [`server:pong`](#serverpong).

```json
{
  "type": "client:ping",
  "ts": 1700000000000
}
```

### Server → Client

#### `server:auth_result`

Authentication result.

```json
{
  "type": "server:auth_result",
  "ok": true,
  "userId": "user-id"
}
```

On failure:

```json
{
  "type": "server:auth_result",
  "ok": false,
  "error": "Invalid token"
}
```

#### `server:new_message`

A new message was sent in a room the client has joined.

```json
{
  "type": "server:new_message",
  "message": {
    "id": "msg-id",
    "roomId": "room-id",
    "senderId": "user-id",
    "senderType": "user",
    "senderName": "alice",
    "type": "text",
    "content": "Hello everyone!",
    "mentions": ["agent-id"],
    "replyToId": null,
    "attachments": [],
    "reactions": [],
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": null,
    "editedAt": null
  }
}
```

#### `server:message_chunk`

A streaming chunk from an AI agent's response. Sent in real time as the agent generates output.

```json
{
  "type": "server:message_chunk",
  "roomId": "room-id",
  "agentId": "agent-id",
  "agentName": "claude-agent",
  "messageId": "msg-id",
  "chunk": {
    "type": "text",
    "content": "Here's my analysis..."
  }
}
```

Chunk types:
- `text` — Main response content (rendered as markdown)
- `thinking` — Internal reasoning / chain of thought (collapsible in UI)
- `tool_use` — Tool invocation (displayed with tool name badge)
- `tool_result` — Tool output (displayed as code block)
- `error` — Error from the agent process

#### `server:message_complete`

An agent has finished generating its response. Contains the full final message.

```json
{
  "type": "server:message_complete",
  "message": { /* full Message object */ }
}
```

#### `server:message_edited`

A message was edited.

```json
{
  "type": "server:message_edited",
  "message": { /* updated Message object with editedAt set */ }
}
```

#### `server:message_deleted`

A message was deleted.

```json
{
  "type": "server:message_deleted",
  "roomId": "room-id",
  "messageId": "msg-id"
}
```

#### `server:typing`

A user is typing in a room.

```json
{
  "type": "server:typing",
  "roomId": "room-id",
  "userId": "user-id",
  "username": "alice"
}
```

#### `server:agent_status`

An agent's status changed (online/offline/busy/error).

```json
{
  "type": "server:agent_status",
  "agent": {
    "id": "agent-id",
    "name": "claude-agent",
    "type": "claude-code",
    "status": "online"
  }
}
```

#### `server:task_update`

A task's status was updated.

```json
{
  "type": "server:task_update",
  "task": { /* full Task object */ }
}
```

#### `server:room_update`

A room's settings or membership changed.

```json
{
  "type": "server:room_update",
  "room": { /* full Room object */ },
  "members": [ /* optional: updated member list */ ]
}
```

#### `server:room_removed`

The client was removed from a room (kicked or room deleted).

```json
{
  "type": "server:room_removed",
  "roomId": "room-id"
}
```

#### `server:terminal_data`

Raw terminal output from an agent process. Used for the terminal viewer in the Web UI.

```json
{
  "type": "server:terminal_data",
  "agentId": "agent-id",
  "agentName": "claude-agent",
  "roomId": "room-id",
  "data": "\u001b[32mSuccess\u001b[0m"
}
```

#### `server:read_receipt`

A user marked a room as read.

```json
{
  "type": "server:read_receipt",
  "roomId": "room-id",
  "userId": "user-id",
  "username": "alice",
  "lastReadAt": "2025-01-01T00:00:00.000Z"
}
```

#### `server:presence`

A user came online or went offline.

```json
{
  "type": "server:presence",
  "userId": "user-id",
  "username": "alice",
  "online": true
}
```

#### `server:reaction_update`

Reactions on a message changed.

```json
{
  "type": "server:reaction_update",
  "roomId": "room-id",
  "messageId": "msg-id",
  "reactions": [
    { "emoji": "thumbsup", "userIds": ["user-1", "user-2"] }
  ]
}
```

#### `server:permission_request`

An agent is requesting permission to use a tool. Displayed as an interactive card in the chat UI.

```json
{
  "type": "server:permission_request",
  "requestId": "perm-request-id",
  "agentId": "agent-id",
  "agentName": "claude-agent",
  "roomId": "room-id",
  "toolName": "Bash",
  "toolInput": { "command": "npm install express" },
  "expiresAt": "2025-01-01T00:05:00.000Z"
}
```

The client should display an Allow/Deny card. If not responded to before `expiresAt`, the server sends `server:permission_request_expired`.

#### `server:permission_request_expired`

A permission request timed out without a response.

```json
{
  "type": "server:permission_request_expired",
  "requestId": "perm-request-id"
}
```

#### `server:pong`

Response to a ping. Echoes the timestamp from the ping.

```json
{
  "type": "server:pong",
  "ts": 1700000000000
}
```

#### `server:error`

An error occurred. See [Error Codes](#error-codes) below.

```json
{
  "type": "server:error",
  "code": "RATE_LIMITED",
  "message": "Too many messages"
}
```

---

## Gateway Protocol (`/ws/gateway`)

### Gateway → Server

#### `gateway:auth`

Authenticate with a JWT token and register the gateway.

```json
{
  "type": "gateway:auth",
  "token": "<JWT access token>",
  "gatewayId": "unique-gateway-id",
  "deviceInfo": {
    "hostname": "dev-machine",
    "platform": "darwin",
    "arch": "arm64",
    "nodeVersion": "v22.0.0"
  }
}
```

Response: [`server:gateway_auth_result`](#servergateway_auth_result)

#### `gateway:register_agent`

Register an AI agent on this gateway. The agent must exist in the database (created via the API).

```json
{
  "type": "gateway:register_agent",
  "agent": {
    "id": "agent-id",
    "name": "my-claude",
    "type": "claude-code",
    "workingDirectory": "/home/user/project",
    "capabilities": ["code", "terminal"]
  }
}
```

#### `gateway:unregister_agent`

Unregister an agent from this gateway (e.g., when the agent process exits).

```json
{
  "type": "gateway:unregister_agent",
  "agentId": "agent-id"
}
```

#### `gateway:message_chunk`

Stream a chunk of an agent's response to a room.

```json
{
  "type": "gateway:message_chunk",
  "roomId": "room-id",
  "agentId": "agent-id",
  "messageId": "msg-id",
  "chunk": {
    "type": "text",
    "content": "Analyzing the code..."
  }
}
```

#### `gateway:message_complete`

Signal that an agent has finished its response.

```json
{
  "type": "gateway:message_complete",
  "roomId": "room-id",
  "agentId": "agent-id",
  "messageId": "msg-id",
  "fullContent": "Here is my complete analysis...",
  "chunks": [ /* optional: array of all ParsedChunk objects */ ],
  "conversationId": "conv-id",
  "depth": 1
}
```

- `conversationId`: Used for agent chain tracking (when one agent's response triggers another agent).
- `depth`: Current depth in the agent chain (protected by `MAX_AGENT_CHAIN_DEPTH`).

#### `gateway:agent_status`

Report an agent's status change.

```json
{
  "type": "gateway:agent_status",
  "agentId": "agent-id",
  "status": "busy"
}
```

Statuses: `online`, `offline`, `busy`, `error`

#### `gateway:terminal_data`

Forward raw terminal output from an agent process.

```json
{
  "type": "gateway:terminal_data",
  "agentId": "agent-id",
  "data": "$ npm test\n\u001b[32mAll tests passed\u001b[0m\n"
}
```

#### `gateway:task_update`

Report a task status change from an agent.

```json
{
  "type": "gateway:task_update",
  "taskId": "task-id",
  "status": "completed",
  "result": "Task completed successfully"
}
```

#### `gateway:permission_request`

Request permission from a human user for an agent tool execution. Sent when the agent is in `interactive` permission mode.

```json
{
  "type": "gateway:permission_request",
  "requestId": "perm-request-id",
  "agentId": "agent-id",
  "roomId": "room-id",
  "toolName": "Write",
  "toolInput": { "file_path": "/src/index.ts", "content": "..." },
  "timeoutMs": 300000
}
```

The server forwards this to room clients as `server:permission_request` and sends the response back as `server:permission_response`.

#### `gateway:ping`

Heartbeat ping. The server responds with [`server:pong`](#serverpong).

```json
{
  "type": "gateway:ping",
  "ts": 1700000000000
}
```

### Server → Gateway

#### `server:gateway_auth_result`

Authentication result for the gateway.

```json
{
  "type": "server:gateway_auth_result",
  "ok": true
}
```

#### `server:send_to_agent`

Deliver a message to an agent for processing. The gateway should forward this to the appropriate agent adapter.

```json
{
  "type": "server:send_to_agent",
  "agentId": "agent-id",
  "roomId": "room-id",
  "messageId": "msg-id",
  "content": "Please review this code",
  "senderName": "alice",
  "senderType": "user",
  "routingMode": "direct",
  "conversationId": "conv-id",
  "depth": 0
}
```

- `routingMode`: `"direct"` (via @mention) or `"broadcast"` (AI router selected this agent)
- `conversationId`: Track conversation chains across multiple agents
- `depth`: Current chain depth. The gateway should pass this to the adapter to include in `gateway:message_complete`

#### `server:room_context`

Room context information sent to an agent when it joins a room or a new message is routed to it. Includes the system prompt and member list.

```json
{
  "type": "server:room_context",
  "agentId": "agent-id",
  "context": {
    "roomId": "room-id",
    "roomName": "Project Discussion",
    "systemPrompt": "You are a helpful coding assistant.",
    "members": [
      { "name": "alice", "type": "user", "role": "owner" },
      { "name": "claude-agent", "type": "agent", "role": "member" }
    ]
  }
}
```

#### `server:stop_agent`

Request the gateway to stop an agent's current generation (triggered by a client's `client:stop_generation`).

```json
{
  "type": "server:stop_agent",
  "agentId": "agent-id"
}
```

#### `server:permission_response`

The user's decision on a permission request, forwarded from the client.

```json
{
  "type": "server:permission_response",
  "requestId": "perm-request-id",
  "agentId": "agent-id",
  "decision": "allow"
}
```

- `decision`: `"allow"`, `"deny"`, or `"timeout"`

#### `server:remove_agent`

The agent was deleted from the server (via API). The gateway should clean up the agent process.

```json
{
  "type": "server:remove_agent",
  "agentId": "agent-id"
}
```

---

## Error Codes

Error codes are sent via `server:error` messages. Defined in `@agentim/shared` as `WS_ERROR_CODES`.

| Code | Description |
|------|-------------|
| `MESSAGE_TOO_LARGE` | Message exceeds the size limit (64 KB for clients, 256 KB for gateways) |
| `JSON_TOO_DEEP` | JSON nesting exceeds the maximum depth |
| `INVALID_JSON` | Message is not valid JSON |
| `INVALID_MESSAGE` | Message doesn't match the expected schema |
| `NOT_AUTHENTICATED` | Action requires authentication |
| `RATE_LIMITED` | Too many messages in the rate limit window |
| `ROOM_NOT_FOUND` | The specified room doesn't exist |
| `NOT_A_MEMBER` | The user/agent is not a member of the room |
| `INTERNAL_ERROR` | An unexpected server error occurred |
| `SESSION_REVOKED` | The user's session was revoked (logout or password change) |
| `SERVER_SHUTDOWN` | The server is shutting down gracefully |

## WebSocket Close Codes

| Code | Description |
|------|-------------|
| `1008` | Policy violation — session revoked (logout / password change while connected) |
| `4001` | Authentication timeout — client/gateway didn't authenticate within 10 seconds |

## Rate Limiting

Client WebSocket messages are rate-limited per connection:

- **Window**: `CLIENT_RATE_LIMIT_WINDOW` (default: 10 seconds)
- **Max messages**: `CLIENT_RATE_LIMIT_MAX` (default: 30 per window)

When the limit is exceeded, the server sends a `RATE_LIMITED` error. The counter resets after the window expires.

Agent-to-agent message routing has separate rate limits controlled by `AGENT_RATE_LIMIT_WINDOW` and `AGENT_RATE_LIMIT_MAX`.

## Connection Limits

| Limit | Env Variable | Default |
|-------|-------------|---------|
| Max client connections per user | `MAX_WS_CONNECTIONS_PER_USER` | 10 |
| Max total client connections | `MAX_TOTAL_WS_CONNECTIONS` | 5000 |
| Max gateway connections per user | `MAX_GATEWAYS_PER_USER` | 20 |

Per-user limits can be overridden in the database (`maxConnections` field on the user record).

## Message Size Limits

| Limit | Value |
|-------|-------|
| Client messages | 64 KB |
| Gateway messages | 256 KB |
| Message content length | 100,000 characters |
| Attachments per message | 20 |
| Reactions per message | 20 |

## Example: Client Connection Flow

```javascript
const ws = new WebSocket('wss://your-server.com/ws/client')

ws.onopen = () => {
  // Step 1: Authenticate
  ws.send(JSON.stringify({
    type: 'client:auth',
    token: accessToken,
  }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'server:auth_result':
      if (msg.ok) {
        // Step 2: Join a room
        ws.send(JSON.stringify({
          type: 'client:join_room',
          roomId: 'my-room-id',
        }))
      }
      break

    case 'server:new_message':
      console.log(`${msg.message.senderName}: ${msg.message.content}`)
      break

    case 'server:message_chunk':
      // Streaming agent response
      process.stdout.write(msg.chunk.content)
      break

    case 'server:message_complete':
      console.log('\n--- Agent response complete ---')
      break

    case 'server:error':
      console.error(`Error [${msg.code}]: ${msg.message}`)
      break
  }
}
```

## Example: Gateway Connection Flow

```javascript
const ws = new WebSocket('wss://your-server.com/ws/gateway')

ws.onopen = () => {
  // Step 1: Authenticate gateway
  ws.send(JSON.stringify({
    type: 'gateway:auth',
    token: accessToken,
    gatewayId: 'my-gateway-id',
    deviceInfo: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
    },
  }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'server:gateway_auth_result':
      if (msg.ok) {
        // Step 2: Register agents
        ws.send(JSON.stringify({
          type: 'gateway:register_agent',
          agent: { id: agentId, name: 'my-agent', type: 'claude-code' },
        }))
      }
      break

    case 'server:send_to_agent':
      // Step 3: Handle incoming messages
      handleAgentMessage(msg)
      break

    case 'server:stop_agent':
      stopAgentProcess(msg.agentId)
      break

    case 'server:remove_agent':
      cleanupAgent(msg.agentId)
      break
  }
}
```
