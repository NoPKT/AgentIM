export const AGENT_TYPES = ['claude-code', 'codex', 'gemini', 'opencode', 'generic'] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export const AGENT_STATUSES = ['online', 'offline', 'busy', 'error'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export const AGENT_VISIBILITIES = ['private', 'shared'] as const
export type AgentVisibility = (typeof AGENT_VISIBILITIES)[number]

export const ROOM_TYPES = ['private', 'group'] as const
export type RoomType = (typeof ROOM_TYPES)[number]

export const MEMBER_ROLES = ['owner', 'admin', 'member'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const MESSAGE_TYPES = ['text', 'system', 'agent_response', 'terminal'] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const CHUNK_TYPES = [
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'error',
  'workspace_status',
] as const
export type ChunkType = (typeof CHUNK_TYPES)[number]

export const ROUTING_MODES = ['broadcast', 'direct'] as const
export type RoutingMode = (typeof ROUTING_MODES)[number]

export const AGENT_CONNECTION_TYPES = ['cli', 'api'] as const
export type AgentConnectionType = (typeof AGENT_CONNECTION_TYPES)[number]

export const NOTIFICATION_PREFS = ['all', 'mentions', 'none'] as const
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number]

export const AGENT_COMMAND_ROLES = ['member', 'admin', 'owner'] as const
export type AgentCommandRole = (typeof AGENT_COMMAND_ROLES)[number]

export const ROUTER_SCOPES = ['global', 'personal'] as const
export type RouterScope = (typeof ROUTER_SCOPES)[number]

export const ROUTER_VISIBILITIES = ['all', 'whitelist', 'blacklist'] as const
export type RouterVisibility = (typeof ROUTER_VISIBILITIES)[number]

export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // SVG intentionally excluded — can contain <script> tags leading to XSS
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
] as const

export const MAX_MESSAGE_LENGTH = 100_000
export const MAX_ROOM_NAME_LENGTH = 100
export const MAX_USERNAME_LENGTH = 50
export const MAX_DISPLAY_NAME_LENGTH = 100
export const MAX_SYSTEM_PROMPT_LENGTH = 10_000
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024 // 10 MB
export const DEFAULT_PAGE_SIZE = 50
export const MAX_ROUTER_NAME_LENGTH = 100
export const MAX_ROUTER_DESCRIPTION_LENGTH = 1000
export const MAX_MENTIONS_PER_MESSAGE = 50
export const MAX_ATTACHMENTS_PER_MESSAGE = 20
export const MAX_ROOM_MEMBERS = 200
export const MAX_REACTIONS_PER_MESSAGE = 50
export const MAX_TOOL_INPUT_KEYS = 100
export const MAX_TOOL_INPUT_KEY_LENGTH = 200
/** Maximum serialized size (bytes) of the entire tool_input record. */
export const MAX_TOOL_INPUT_SIZE = 1_000_000 // 1 MB

/** Dangerous key names that could cause prototype pollution if passed through to objects */
export const DANGEROUS_KEY_NAMES = ['__proto__', 'constructor', 'prototype'] as const

export const MEMBER_TYPES = ['user', 'agent'] as const
export type MemberType = (typeof MEMBER_TYPES)[number]

export const ASSIGNEE_TYPES = ['user', 'agent'] as const
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number]

export const SENDER_TYPES = ['user', 'agent', 'system'] as const
export type SenderType = (typeof SENDER_TYPES)[number]

export const PERMISSION_LEVELS = ['bypass', 'interactive'] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

export const PERMISSION_DECISIONS = ['allow', 'deny', 'timeout'] as const
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]

export const PERMISSION_TIMEOUT_MS = 300_000 // 5 minutes

/** Maximum size (bytes) for a single WebSocket message payload (client → server).
 *  Must accommodate MAX_MESSAGE_LENGTH (100 KB content) plus JSON envelope overhead. */
export const WS_CLIENT_MESSAGE_SIZE_LIMIT = 128 * 1024 // 128 KB
export const WS_GATEWAY_MESSAGE_SIZE_LIMIT = 256 * 1024 // 256 KB

/** Maximum allowed fullContent size in gateway:message_complete (must fit within WS frame with overhead). */
export const MAX_FULL_CONTENT_SIZE = 200_000 // 200 KB

/** Maximum JSON nesting depth for WebSocket message parsing. */
export const MAX_JSON_DEPTH = 15

/** Current WebSocket protocol version. Bumped when breaking changes are introduced. */
export const CURRENT_PROTOCOL_VERSION = '1'

// ─── WebSocket Error Codes ───

/** Error codes sent to clients via server:error messages. */
export const WS_ERROR_CODES = {
  MESSAGE_TOO_LARGE: 'MESSAGE_TOO_LARGE',
  JSON_TOO_DEEP: 'JSON_TOO_DEEP',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  GATEWAY_NOT_FOUND: 'GATEWAY_NOT_FOUND',
  STREAM_TOO_LARGE: 'STREAM_TOO_LARGE',
} as const
export type WsErrorCode = (typeof WS_ERROR_CODES)[keyof typeof WS_ERROR_CODES]

// ─── Stream Size Limit ───
export const MAX_STREAM_TOTAL_SIZE = 10 * 1024 * 1024 // 10 MB cumulative stream limit

// ─── Service Agent Types ───
export const SERVICE_AGENT_TYPES = [
  'openai-chat',
  'perplexity',
  'openai-image',
  'elevenlabs',
  'runway',
  'stability-audio',
  'meshy',
  'custom',
] as const
export type ServiceAgentType = (typeof SERVICE_AGENT_TYPES)[number]

export const SERVICE_AGENT_CATEGORIES = [
  'chat',
  'search',
  'image',
  'audio',
  'video',
  'music',
  '3d',
] as const
export type ServiceAgentCategory = (typeof SERVICE_AGENT_CATEGORIES)[number]

export const SERVICE_AGENT_STATUSES = ['active', 'inactive', 'error'] as const
export type ServiceAgentStatus = (typeof SERVICE_AGENT_STATUSES)[number]

export const MAX_SERVICE_AGENT_FILE_SIZE = 100 * 1024 * 1024 // 100 MB for media files

// ─── Slash Commands ───
export const SLASH_COMMANDS = ['clear', 'help', 'task', 'status'] as const
export type SlashCommandName = (typeof SLASH_COMMANDS)[number]

// ─── Web Client Constants (migrated from web package) ───
export const MAX_WS_QUEUE_SIZE = 500
export const MAX_CACHED_MESSAGES = 1000
export const MAX_CHUNKS_PER_STREAM = 2000
export const MAX_MESSAGES_PER_ROOM_CACHE = 200
export const MAX_RECONNECT_ATTEMPTS = 50
