export const AGENT_TYPES = ['claude-code', 'codex', 'gemini', 'cursor', 'generic'] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export const AGENT_STATUSES = ['online', 'offline', 'busy', 'error'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

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

export const MAX_MESSAGE_LENGTH = 100_000
export const MAX_ROOM_NAME_LENGTH = 100
export const MAX_USERNAME_LENGTH = 50
export const DEFAULT_PAGE_SIZE = 50
