import { z } from 'zod'
import {
  AGENT_TYPES,
  AGENT_STATUSES,
  AGENT_VISIBILITIES,
  ROOM_TYPES,
  MEMBER_ROLES,
  MESSAGE_TYPES,
  TASK_STATUSES,
  CHUNK_TYPES,
  USER_ROLES,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
} from './constants.js'

// ─── Password Complexity ───

const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((p) => /[a-z]/.test(p), 'Password must contain a lowercase letter')
  .refine((p) => /[A-Z]/.test(p), 'Password must contain an uppercase letter')
  .refine((p) => /[0-9]/.test(p), 'Password must contain a digit')

// ─── Auth ───

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(MAX_USERNAME_LENGTH)
    .regex(/^[a-zA-Z0-9_-]+$/),
  password: passwordSchema,
  displayName: z.string().min(1).max(MAX_USERNAME_LENGTH).optional(),
})

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

// ─── Room ───

export const createRoomSchema = z.object({
  name: z.string().min(1).max(MAX_ROOM_NAME_LENGTH),
  type: z.enum(ROOM_TYPES).default('group'),
  broadcastMode: z.boolean().default(false),
  systemPrompt: z.string().max(10000).optional(),
  memberIds: z.array(z.string()).optional(),
})

export const updateRoomSchema = z.object({
  name: z.string().min(1).max(MAX_ROOM_NAME_LENGTH).optional(),
  broadcastMode: z.boolean().optional(),
  systemPrompt: z.string().max(10000).nullable().optional(),
})

export const addMemberSchema = z.object({
  memberId: z.string().min(1),
  memberType: z.enum(['user', 'agent']),
  role: z.enum(MEMBER_ROLES).default('member'),
  roleDescription: z.string().max(500).optional(),
})

// ─── Message ───

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  mentions: z.array(z.string()).default([]),
  replyToId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
})

export const editMessageSchema = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
})

export const messageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

// ─── Task ───

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).default(''),
  assigneeId: z.string().optional(),
  assigneeType: z.enum(['user', 'agent']).optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeType: z.enum(['user', 'agent']).nullable().optional(),
})

// ─── Agent ───

export const updateAgentSchema = z.object({
  visibility: z.enum(AGENT_VISIBILITIES).optional(),
})

// ─── User ───

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(MAX_USERNAME_LENGTH).optional(),
  avatarUrl: z.string().url().optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})

export const adminCreateUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(MAX_USERNAME_LENGTH)
    .regex(/^[a-zA-Z0-9_-]+$/),
  password: passwordSchema,
  displayName: z.string().min(1).max(MAX_USERNAME_LENGTH).optional(),
  role: z.enum(USER_ROLES).default('user'),
})

export const adminUpdateUserSchema = z.object({
  displayName: z.string().min(1).max(MAX_USERNAME_LENGTH).optional(),
  role: z.enum(USER_ROLES).optional(),
  password: passwordSchema.optional(),
})

// ─── WebSocket Protocol Validators ───

const parsedChunkSchema = z.object({
  type: z.enum(CHUNK_TYPES),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
})

// Client messages
export const clientAuthSchema = z.object({
  type: z.literal('client:auth'),
  token: z.string().min(1),
})

export const clientJoinRoomSchema = z.object({
  type: z.literal('client:join_room'),
  roomId: z.string().min(1),
})

export const clientLeaveRoomSchema = z.object({
  type: z.literal('client:leave_room'),
  roomId: z.string().min(1),
})

export const clientSendMessageSchema = z.object({
  type: z.literal('client:send_message'),
  roomId: z.string().min(1),
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  mentions: z.array(z.string()).default([]),
  replyToId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
})

export const clientTypingSchema = z.object({
  type: z.literal('client:typing'),
  roomId: z.string().min(1),
})

export const clientStopGenerationSchema = z.object({
  type: z.literal('client:stop_generation'),
  roomId: z.string().min(1),
  agentId: z.string().min(1),
})

export const clientPingSchema = z.object({
  type: z.literal('client:ping'),
  ts: z.number(),
})

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientAuthSchema,
  clientJoinRoomSchema,
  clientLeaveRoomSchema,
  clientSendMessageSchema,
  clientTypingSchema,
  clientStopGenerationSchema,
  clientPingSchema,
])

// Gateway messages
export const gatewayAuthSchema = z.object({
  type: z.literal('gateway:auth'),
  token: z.string().min(1),
  gatewayId: z.string().min(1),
  deviceInfo: z.object({
    hostname: z.string(),
    platform: z.string(),
    arch: z.string(),
    nodeVersion: z.string(),
  }),
})

export const gatewayRegisterAgentSchema = z.object({
  type: z.literal('gateway:register_agent'),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string(),
    workingDirectory: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
  }),
})

export const gatewayUnregisterAgentSchema = z.object({
  type: z.literal('gateway:unregister_agent'),
  agentId: z.string().min(1),
})

export const gatewayMessageChunkSchema = z.object({
  type: z.literal('gateway:message_chunk'),
  roomId: z.string().min(1),
  agentId: z.string().min(1),
  messageId: z.string().min(1),
  chunk: parsedChunkSchema,
})

export const gatewayMessageCompleteSchema = z.object({
  type: z.literal('gateway:message_complete'),
  roomId: z.string().min(1),
  agentId: z.string().min(1),
  messageId: z.string().min(1),
  fullContent: z.string(),
  chunks: z.array(parsedChunkSchema).optional(),
  conversationId: z.string().optional(),
  depth: z.number().int().min(0).optional(),
})

export const gatewayAgentStatusSchema = z.object({
  type: z.literal('gateway:agent_status'),
  agentId: z.string().min(1),
  status: z.enum(AGENT_STATUSES),
})

export const gatewayTerminalDataSchema = z.object({
  type: z.literal('gateway:terminal_data'),
  agentId: z.string().min(1),
  data: z.string(),
})

export const gatewayTaskUpdateSchema = z.object({
  type: z.literal('gateway:task_update'),
  taskId: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  result: z.string().optional(),
})

export const gatewayPingSchema = z.object({
  type: z.literal('gateway:ping'),
  ts: z.number(),
})

export const gatewayMessageSchema = z.discriminatedUnion('type', [
  gatewayAuthSchema,
  gatewayRegisterAgentSchema,
  gatewayUnregisterAgentSchema,
  gatewayMessageChunkSchema,
  gatewayMessageCompleteSchema,
  gatewayAgentStatusSchema,
  gatewayTerminalDataSchema,
  gatewayTaskUpdateSchema,
  gatewayPingSchema,
])
