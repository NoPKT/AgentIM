import type {
  AgentType,
  AgentStatus,
  AgentVisibility,
  AgentConnectionType,
  AgentCommandRole,
  UserRole,
  RoomType,
  MemberRole,
  MessageType,
  TaskStatus,
  ChunkType,
  RouterScope,
  RouterVisibility,
} from './constants.js'

// ─── Core Entities ───

export interface User {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  name: string
  type: AgentType
  status: AgentStatus
  visibility?: AgentVisibility
  gatewayId: string
  workingDirectory?: string
  capabilities?: string[]
  connectionType?: AgentConnectionType
  deviceInfo?: DeviceInfo
  ownerName?: string
  lastSeenAt?: string
  createdAt: string
  updatedAt: string
}

export interface DeviceInfo {
  hostname: string
  platform: string
  arch: string
  nodeVersion: string
  agentimVersion?: string
}

export interface Gateway {
  id: string
  userId: string
  name: string
  deviceInfo: DeviceInfo
  connectedAt?: string
  disconnectedAt?: string
  createdAt: string
}

export interface Router {
  id: string
  name: string
  description?: string | null
  scope: RouterScope
  createdById: string
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  maxChainDepth: number
  rateLimitWindow: number
  rateLimitMax: number
  visibility: RouterVisibility
  visibilityList: string[]
  createdAt: string
  updatedAt: string
}

export interface Room {
  id: string
  name: string
  type: RoomType
  broadcastMode: boolean
  systemPrompt?: string
  routerId?: string | null
  agentCommandRole?: AgentCommandRole
  createdById: string
  pinnedAt?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface RoomMember {
  roomId: string
  memberId: string
  memberType: 'user' | 'agent'
  role: MemberRole
  roleDescription?: string
  notificationPref?: 'all' | 'mentions' | 'none'
  pinnedAt?: string
  archivedAt?: string
  lastReadAt?: string
  joinedAt: string
}

export interface Message {
  id: string
  roomId: string
  senderId: string
  senderType: 'user' | 'agent' | 'system'
  senderName: string
  type: MessageType
  content: string
  replyToId?: string
  mentions: string[]
  attachments?: MessageAttachment[]
  reactions?: MessageReaction[]
  chunks?: ParsedChunk[]
  createdAt: string
  updatedAt?: string
}

export interface MessageAttachment {
  id: string
  messageId: string
  filename: string
  mimeType: string
  size: number
  url: string
}

export interface MessageReaction {
  emoji: string
  userIds: string[]
  usernames: string[]
}

export interface Task {
  id: string
  roomId: string
  title: string
  description: string
  status: TaskStatus
  assigneeId?: string
  assigneeType?: 'user' | 'agent'
  createdById: string
  createdAt: string
  updatedAt: string
}

// ─── Streaming ───

export interface ParsedChunk {
  type: ChunkType
  content: string
  metadata?: Record<string, unknown>
}

// ─── Workspace Status ───

export interface WorkspaceFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions?: number
  deletions?: number
  diff?: string
}

export interface WorkspaceStatus {
  branch: string
  changedFiles: WorkspaceFileChange[]
  summary: { filesChanged: number; additions: number; deletions: number }
  recentCommits?: Array<{ hash: string; message: string }>
}

// ─── Auth ───

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface JwtPayload {
  sub: string
  username: string
  type: 'access' | 'refresh'
}

// ─── API Responses ───

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  /** Field-level validation errors, present when error is 'Validation failed' */
  fields?: { field: string; message: string }[]
}

export interface PaginatedResponse<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

// ─── Room Context (sent to agents) ───

export interface RoomContextMember {
  id: string
  name: string
  type: 'user' | 'agent'
  agentType?: AgentType
  capabilities?: string[]
  roleDescription?: string
  status?: AgentStatus
}

export interface RoomContext {
  roomId: string
  roomName: string
  systemPrompt?: string
  members: RoomContextMember[]
}
