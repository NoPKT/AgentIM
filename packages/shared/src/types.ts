import type {
  AgentType,
  AgentStatus,
  AgentVisibility,
  AgentConnectionType,
  AgentCommandRole,
  AgentCommandSource,
  UserRole,
  RoomType,
  MemberRole,
  MemberType,
  MessageType,
  TaskStatus,
  ChunkType,
  RouterScope,
  RouterVisibility,
  SenderType,
  AssigneeType,
  NotificationPref,
  ServiceAgentType,
  ServiceAgentCategory,
  ServiceAgentStatus,
  SlashCommandName,
} from './constants.js'

// ─── Core Entities ───

export interface User {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
  role: UserRole
  totpEnabled?: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentSlashCommand {
  name: string
  description: string
  usage: string
  source: AgentCommandSource
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
  slashCommands?: AgentSlashCommand[]
  mcpServers?: string[]
  model?: string
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
  memberType: MemberType
  role: MemberRole
  roleDescription?: string
  notificationPref?: NotificationPref
  displayName?: string
  pinnedAt?: string
  archivedAt?: string
  lastReadAt?: string
  joinedAt: string
}

export interface Message {
  id: string
  roomId: string
  senderId: string
  senderType: SenderType
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

/**
 * Aggregated reaction on a message. The `userIds` and `usernames` arrays
 * MUST have the same length — index i of each array corresponds to the
 * same user.
 */
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
  result?: string
  dueDate?: string
  assigneeId?: string
  assigneeType?: AssigneeType
  createdById: string
  createdAt: string
  updatedAt: string
}

// ─── Bookmarks ───

export interface Bookmark {
  id: string
  userId: string
  messageId: string
  note: string
  createdAt: string
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
  /** Issued-at timestamp (seconds since epoch), set by jose during signing */
  iat?: number
  /** Expiration timestamp (seconds since epoch), set by jose during signing */
  exp?: number
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
  type: MemberType
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

// ─── Service Agents ───

export interface ServiceAgent {
  id: string
  name: string
  type: ServiceAgentType
  category: ServiceAgentCategory
  description?: string
  status: ServiceAgentStatus
  avatarUrl?: string
  createdById: string
  createdAt: string
  updatedAt: string
}

/** ServiceAgent with decrypted configuration, returned by single-resource GET endpoints. */
export interface ServiceAgentWithConfig extends ServiceAgent {
  config: Record<string, unknown>
}

// ─── OAuth ───

export type OAuthProvider = 'github' | 'google'

export interface OAuthAccount {
  id: string
  userId: string
  provider: OAuthProvider
  providerAccountId: string
  email?: string | null
  displayName?: string | null
  avatarUrl?: string | null
  createdAt: string
  updatedAt: string
}

// ─── Slash Commands ───

/** Client-side slash command definition. */
export interface SlashCommand {
  name: SlashCommandName
  description: string
  usage: string
  /** Whether this command is handled purely on the client (true) or sent to the server (false). */
  clientOnly: boolean
}
