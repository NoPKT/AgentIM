import type {
  AgentType,
  AgentStatus,
  RoomType,
  MemberRole,
  MessageType,
  TaskStatus,
  ChunkType,
} from './constants.js'

// ─── Core Entities ───

export interface User {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  name: string
  type: AgentType
  status: AgentStatus
  gatewayId: string
  workingDirectory?: string
  deviceInfo?: DeviceInfo
  lastSeenAt?: string
  createdAt: string
  updatedAt: string
}

export interface DeviceInfo {
  hostname: string
  platform: string
  arch: string
  nodeVersion: string
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

export interface Room {
  id: string
  name: string
  type: RoomType
  broadcastMode: boolean
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface RoomMember {
  roomId: string
  memberId: string
  memberType: 'user' | 'agent'
  role: MemberRole
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
  chunks?: ParsedChunk[]
  createdAt: string
}

export interface MessageAttachment {
  id: string
  messageId: string
  filename: string
  mimeType: string
  size: number
  url: string
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
}

export interface PaginatedResponse<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}
