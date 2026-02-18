export const AGENT_TYPES = ['claude-code', 'codex', 'gemini', 'cursor', 'generic'] as const
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

export const CHUNK_TYPES = ['text', 'thinking', 'tool_use', 'tool_result', 'error'] as const
export type ChunkType = (typeof CHUNK_TYPES)[number]

export const ROUTING_MODES = ['broadcast', 'direct'] as const
export type RoutingMode = (typeof ROUTING_MODES)[number]

export const AGENT_CONNECTION_TYPES = ['cli', 'api'] as const
export type AgentConnectionType = (typeof AGENT_CONNECTION_TYPES)[number]

export const NOTIFICATION_PREFS = ['all', 'mentions', 'none'] as const
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number]

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
  'application/json',
  'application/zip',
  'application/gzip',
] as const

export const MAX_MESSAGE_LENGTH = 100_000
export const MAX_ROOM_NAME_LENGTH = 100
export const MAX_USERNAME_LENGTH = 50
export const MAX_SYSTEM_PROMPT_LENGTH = 10_000
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024 // 10 MB
export const DEFAULT_PAGE_SIZE = 50

export const MEMBER_TYPES = ['user', 'agent'] as const
export type MemberType = (typeof MEMBER_TYPES)[number]

export const SENDER_TYPES = ['user', 'agent', 'system'] as const
export type SenderType = (typeof SENDER_TYPES)[number]
