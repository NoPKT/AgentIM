import { z } from 'zod'
import {
  AGENT_TYPES,
  AGENT_STATUSES,
  AGENT_VISIBILITIES,
  AGENT_CONNECTION_TYPES,
  AGENT_COMMAND_ROLES,
  ROOM_TYPES,
  MEMBER_ROLES,
  MESSAGE_TYPES,
  TASK_STATUSES,
  CHUNK_TYPES,
  ROUTING_MODES,
  USER_ROLES,
  ROUTER_SCOPES,
  ROUTER_VISIBILITIES,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_ROUTER_NAME_LENGTH,
  MAX_ROUTER_DESCRIPTION_LENGTH,
  MAX_MENTIONS_PER_MESSAGE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOOL_INPUT_KEYS,
  MAX_TOOL_INPUT_KEY_LENGTH,
  DANGEROUS_KEY_NAMES,
  MEMBER_TYPES,
  SENDER_TYPES,
  ASSIGNEE_TYPES,
  NOTIFICATION_PREFS,
  PERMISSION_DECISIONS,
  SERVICE_AGENT_TYPES,
  SERVICE_AGENT_CATEGORIES,
  SERVICE_AGENT_STATUSES,
} from './constants.js'

// ─── Shared Tool Input Schema ───

export const toolInputSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (obj) => Object.keys(obj).length <= MAX_TOOL_INPUT_KEYS,
    'validation.toolInputTooManyKeys',
  )
  .refine(
    (obj) => Object.keys(obj).every((k) => k.length <= MAX_TOOL_INPUT_KEY_LENGTH),
    'validation.toolInputKeyTooLong',
  )
  .refine(
    (obj) => !Object.keys(obj).some((k) => (DANGEROUS_KEY_NAMES as readonly string[]).includes(k)),
    'validation.toolInputDangerousKey',
  )

// ─── Password Complexity ───

const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((p) => /[a-z]/.test(p), 'validation.passwordLowercase')
  .refine((p) => /[A-Z]/.test(p), 'validation.passwordUppercase')
  .refine((p) => /[0-9]/.test(p), 'validation.passwordDigit')

// ─── Auth ───

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(MAX_USERNAME_LENGTH)
    .regex(/^[a-zA-Z0-9_-]+$/),
  password: passwordSchema,
  displayName: z
    .string()
    .min(1)
    .max(MAX_DISPLAY_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.displayNameWhitespace')
    .optional(),
})

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(2000),
})

// ─── Room ───

export const createRoomSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_ROOM_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.nameWhitespace'),
  type: z.enum(ROOM_TYPES).default('group'),
  broadcastMode: z.boolean().default(false),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
  routerId: z.string().max(100).optional(),
  agentCommandRole: z.enum(AGENT_COMMAND_ROLES).default('member'),
  memberIds: z.array(z.string().max(100)).max(100).optional(),
})

export const updateRoomSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_ROOM_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.nameWhitespace')
    .optional(),
  broadcastMode: z.boolean().optional(),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).nullable().optional(),
  routerId: z.string().max(100).nullable().optional(),
  agentCommandRole: z.enum(AGENT_COMMAND_ROLES).optional(),
})

// ─── Router ───

export const createRouterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(MAX_ROUTER_NAME_LENGTH)
      .refine((s) => s.trim().length > 0, 'validation.nameWhitespace'),
    description: z.string().max(MAX_ROUTER_DESCRIPTION_LENGTH).optional(),
    scope: z.enum(ROUTER_SCOPES).default('personal'),
    llmBaseUrl: z
      .string()
      .url()
      .max(500)
      .refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'validation.httpUrl'),
    llmApiKey: z
      .string()
      .min(1)
      .max(500)
      .refine((s) => s.trim().length > 0, 'validation.apiKeyWhitespace'),
    llmModel: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => s.trim().length > 0, 'validation.modelWhitespace'),
    maxChainDepth: z.number().int().min(1).max(100).default(5),
    rateLimitWindow: z.number().int().min(1).max(3600).default(60),
    rateLimitMax: z.number().int().min(1).max(1000).default(20),
    visibility: z.enum(ROUTER_VISIBILITIES).default('all'),
    visibilityList: z.array(z.string().max(100)).max(500).default([]),
  })
  .superRefine((data, ctx) => {
    if (
      (data.visibility === 'whitelist' || data.visibility === 'blacklist') &&
      data.visibilityList.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `visibilityList must not be empty when visibility is '${data.visibility}'`,
        path: ['visibilityList'],
      })
    }
  })

export const updateRouterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(MAX_ROUTER_NAME_LENGTH)
      .refine((s) => s.trim().length > 0, 'validation.nameWhitespace')
      .optional(),
    description: z.string().max(MAX_ROUTER_DESCRIPTION_LENGTH).nullable().optional(),
    llmBaseUrl: z
      .string()
      .url()
      .max(500)
      .refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'validation.httpUrl')
      .optional(),
    llmApiKey: z
      .string()
      .min(1)
      .max(500)
      .refine((s) => s.trim().length > 0, 'validation.apiKeyWhitespace')
      .optional(),
    llmModel: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => s.trim().length > 0, 'validation.modelWhitespace')
      .optional(),
    maxChainDepth: z.number().int().min(1).max(100).optional(),
    rateLimitWindow: z.number().int().min(1).max(3600).optional(),
    rateLimitMax: z.number().int().min(1).max(1000).optional(),
    visibility: z.enum(ROUTER_VISIBILITIES).optional(),
    visibilityList: z.array(z.string().max(100)).max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.visibility !== undefined &&
      (data.visibility === 'whitelist' || data.visibility === 'blacklist') &&
      data.visibilityList !== undefined &&
      data.visibilityList.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `visibilityList must not be empty when visibility is '${data.visibility}'`,
        path: ['visibilityList'],
      })
    }
  })

export const addMemberSchema = z.object({
  memberId: z.string().min(1).max(100),
  memberType: z.enum(MEMBER_TYPES),
  role: z.enum(MEMBER_ROLES).default('member'),
  roleDescription: z.string().max(500).optional(),
})

// ─── Message ───

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  mentions: z.array(z.string()).max(MAX_MENTIONS_PER_MESSAGE).default([]),
  replyToId: z.string().optional(),
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
})

export const editMessageSchema = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
})

export const messageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const searchMessagesSchema = z.object({
  q: z.string().min(1).max(500),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  roomId: z.string().max(100).optional(),
  senderId: z.string().max(100).optional(),
  senderType: z.enum(SENDER_TYPES).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

export const batchDeleteMessagesSchema = z.object({
  messageIds: z.array(z.string().min(1).max(100)).min(1).max(50),
})

// ─── Bookmark ───

export const createBookmarkSchema = z.object({
  messageId: z.string().min(1).max(100),
  note: z.string().max(500).default(''),
})

// ─── Forward Message ───

export const forwardMessageSchema = z.object({
  targetRoomId: z.string().min(1).max(100),
})

// ─── Task ───

export const createTaskSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.trim().length > 0, 'validation.titleWhitespace'),
  description: z.string().max(10000).default(''),
  assigneeId: z.string().max(100).optional(),
  assigneeType: z.enum(ASSIGNEE_TYPES).optional(),
})

export const updateTaskSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.trim().length > 0, 'validation.titleWhitespace')
    .optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().max(100).nullable().optional(),
  assigneeType: z.enum(ASSIGNEE_TYPES).nullable().optional(),
})

// ─── Agent ───

export const updateAgentSchema = z.object({
  visibility: z.enum(AGENT_VISIBILITIES).optional(),
})

// ─── Service Agent ───

export const serviceAgentConfigSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (obj) => !Object.keys(obj).some((k) => (DANGEROUS_KEY_NAMES as readonly string[]).includes(k)),
    'validation.configDangerousKey',
  )

export const createServiceAgentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .refine((s) => s.trim().length > 0, 'validation.nameWhitespace'),
    type: z.enum(SERVICE_AGENT_TYPES).default('openai-chat'),
    category: z.enum(SERVICE_AGENT_CATEGORIES).optional(),
    description: z.string().max(1000).optional(),
    config: serviceAgentConfigSchema,
  })
  .superRefine((data, ctx) => {
    // For non-custom types, apiKey is required in config
    if (data.type !== 'custom' && !data.config.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'config.apiKey is required for non-custom service agent types',
        path: ['config', 'apiKey'],
      })
    }
  })

export const updateServiceAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .refine((s) => s.trim().length > 0, 'validation.nameWhitespace')
    .optional(),
  type: z.enum(SERVICE_AGENT_TYPES).optional(),
  category: z.enum(SERVICE_AGENT_CATEGORIES).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(SERVICE_AGENT_STATUSES).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

// ─── User ───

export const updateUserSchema = z.object({
  displayName: z
    .string()
    .min(1)
    .max(MAX_DISPLAY_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.displayNameWhitespace')
    .optional(),
  avatarUrl: z
    .string()
    .startsWith('/uploads/')
    .max(500)
    .refine((s) => !s.includes('..'), 'validation.avatarUrlTraversal')
    .refine(
      (s) => /^\/uploads\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(s),
      'validation.avatarUrlInvalid',
    )
    .optional(),
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
  displayName: z
    .string()
    .min(1)
    .max(MAX_DISPLAY_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.displayNameWhitespace')
    .optional(),
  role: z.enum(USER_ROLES).default('user'),
})

export const adminUpdateUserSchema = z.object({
  displayName: z
    .string()
    .min(1)
    .max(MAX_DISPLAY_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.displayNameWhitespace')
    .optional(),
  role: z.enum(USER_ROLES).optional(),
  password: passwordSchema.optional(),
  maxWsConnections: z.number().int().min(1).max(1000).nullable().optional(),
  maxGateways: z.number().int().min(1).max(1000).nullable().optional(),
})

// ─── WebSocket Protocol Validators ───

const parsedChunkSchema = z.object({
  type: z.enum(CHUNK_TYPES),
  content: z.string().max(1_000_000),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length <= 50, 'validation.metadataTooManyKeys')
    .optional(),
})

// Client messages
export const clientAuthSchema = z.object({
  type: z.literal('client:auth'),
  token: z.string().min(1).max(2000),
  protocolVersion: z.string().optional(),
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
  mentions: z.array(z.string()).max(MAX_MENTIONS_PER_MESSAGE).default([]),
  replyToId: z.string().optional(),
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
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

export const clientPermissionResponseSchema = z.object({
  type: z.literal('client:permission_response'),
  requestId: z.string().min(1).max(100),
  decision: z.enum(['allow', 'deny']),
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
  clientPermissionResponseSchema,
  clientPingSchema,
])

// Gateway messages
export const gatewayAuthSchema = z.object({
  type: z.literal('gateway:auth'),
  token: z.string().min(1).max(2000),
  gatewayId: z.string().min(1),
  protocolVersion: z.string().optional(),
  deviceInfo: z.object({
    hostname: z.string(),
    platform: z.string(),
    arch: z.string(),
    nodeVersion: z.string(),
    agentimVersion: z.string().optional(),
  }),
})

export const gatewayRegisterAgentSchema = z.object({
  type: z.literal('gateway:register_agent'),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(AGENT_TYPES),
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
  fullContent: z.string().max(200_000),
  chunks: z.array(parsedChunkSchema).max(5_000).optional(),
  conversationId: z.string().max(100).optional(),
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
  data: z.string().max(1_000_000),
})

export const gatewayTaskUpdateSchema = z.object({
  type: z.literal('gateway:task_update'),
  taskId: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  result: z.string().optional(),
})

export const gatewayPermissionRequestSchema = z.object({
  type: z.literal('gateway:permission_request'),
  requestId: z.string().min(1).max(100),
  agentId: z.string().min(1),
  roomId: z.string().min(1),
  toolName: z.string().min(1).max(200),
  toolInput: toolInputSchema,
  timeoutMs: z.number().int().min(1000).max(600_000),
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
  gatewayPermissionRequestSchema,
  gatewayPingSchema,
])

// ─── Entity Schemas (used by server messages) ───

const messageAttachmentSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  url: z.string(),
})

const messageReactionSchema = z.object({
  emoji: z.string(),
  userIds: z.array(z.string()),
  usernames: z.array(z.string()),
})

const messageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  senderId: z.string(),
  senderType: z.enum(SENDER_TYPES),
  senderName: z.string(),
  type: z.enum(MESSAGE_TYPES),
  content: z.string(),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()),
  attachments: z.array(messageAttachmentSchema).optional(),
  reactions: z.array(messageReactionSchema).optional(),
  chunks: z.array(parsedChunkSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
})

const deviceInfoSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  nodeVersion: z.string(),
  agentimVersion: z.string().optional(),
})

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(AGENT_TYPES),
  status: z.enum(AGENT_STATUSES),
  visibility: z.enum(AGENT_VISIBILITIES).optional(),
  gatewayId: z.string(),
  workingDirectory: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  connectionType: z.enum(AGENT_CONNECTION_TYPES).optional(),
  deviceInfo: deviceInfoSchema.optional(),
  ownerName: z.string().optional(),
  lastSeenAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const taskSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(TASK_STATUSES),
  result: z.string().optional(),
  dueDate: z.string().optional(),
  assigneeId: z.string().optional(),
  assigneeType: z.enum(ASSIGNEE_TYPES).optional(),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ROOM_TYPES),
  broadcastMode: z.boolean(),
  systemPrompt: z.string().optional(),
  routerId: z.string().nullable().optional(),
  agentCommandRole: z.enum(AGENT_COMMAND_ROLES).optional(),
  createdById: z.string(),
  pinnedAt: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const roomMemberSchema = z.object({
  roomId: z.string(),
  memberId: z.string(),
  memberType: z.enum(MEMBER_TYPES),
  role: z.enum(MEMBER_ROLES),
  roleDescription: z.string().optional(),
  notificationPref: z.enum(NOTIFICATION_PREFS).optional(),
  pinnedAt: z.string().optional(),
  archivedAt: z.string().optional(),
  lastReadAt: z.string().optional(),
  joinedAt: z.string(),
})

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  role: z.enum(USER_ROLES),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const gatewaySchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  deviceInfo: z.object({
    hostname: z.string(),
    platform: z.string(),
    arch: z.string(),
    nodeVersion: z.string(),
    agentimVersion: z.string().optional(),
  }),
  connectedAt: z.string().optional(),
  disconnectedAt: z.string().optional(),
  createdAt: z.string(),
})

const roomContextMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(MEMBER_TYPES),
  agentType: z.enum(AGENT_TYPES).optional(),
  capabilities: z.array(z.string()).optional(),
  roleDescription: z.string().optional(),
  status: z.enum(AGENT_STATUSES).optional(),
})

const roomContextSchema = z.object({
  roomId: z.string(),
  roomName: z.string(),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
  members: z.array(roomContextMemberSchema),
})

// ─── Server → Client Messages ───

export const serverAuthResultSchema = z.object({
  type: z.literal('server:auth_result'),
  ok: z.boolean(),
  error: z.string().optional(),
  userId: z.string().optional(),
})

export const serverNewMessageSchema = z.object({
  type: z.literal('server:new_message'),
  message: messageSchema,
})

export const serverMessageChunkSchema = z.object({
  type: z.literal('server:message_chunk'),
  roomId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  messageId: z.string(),
  chunk: parsedChunkSchema,
})

export const serverMessageCompleteSchema = z.object({
  type: z.literal('server:message_complete'),
  message: messageSchema,
})

export const serverServiceAgentResponseSchema = z.object({
  type: z.literal('server:service_agent_response'),
  roomId: z.string(),
  serviceAgentId: z.string(),
  serviceAgentName: z.string(),
  message: messageSchema,
})

export const serverTypingSchema = z.object({
  type: z.literal('server:typing'),
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
})

export const serverAgentStatusSchema = z.object({
  type: z.literal('server:agent_status'),
  agent: agentSchema.pick({ id: true, name: true, type: true, status: true }),
})

export const serverTaskUpdateSchema = z.object({
  type: z.literal('server:task_update'),
  task: taskSchema,
})

export const serverRoomUpdateSchema = z.object({
  type: z.literal('server:room_update'),
  room: roomSchema,
  members: z.array(roomMemberSchema).optional(),
})

export const serverTerminalDataSchema = z.object({
  type: z.literal('server:terminal_data'),
  agentId: z.string(),
  agentName: z.string(),
  roomId: z.string(),
  data: z.string(),
})

export const serverMessageEditedSchema = z.object({
  type: z.literal('server:message_edited'),
  message: messageSchema,
})

export const serverMessageDeletedSchema = z.object({
  type: z.literal('server:message_deleted'),
  roomId: z.string(),
  messageId: z.string(),
})

export const serverReadReceiptSchema = z.object({
  type: z.literal('server:read_receipt'),
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
  lastReadAt: z.string(),
})

export const serverPresenceSchema = z.object({
  type: z.literal('server:presence'),
  userId: z.string(),
  username: z.string(),
  online: z.boolean(),
})

export const serverReactionUpdateSchema = z.object({
  type: z.literal('server:reaction_update'),
  roomId: z.string(),
  messageId: z.string(),
  reactions: z.array(messageReactionSchema),
})

export const serverPermissionRequestSchema = z.object({
  type: z.literal('server:permission_request'),
  requestId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  roomId: z.string(),
  toolName: z.string(),
  toolInput: toolInputSchema,
  expiresAt: z.string(),
})

export const serverPermissionRequestExpiredSchema = z.object({
  type: z.literal('server:permission_request_expired'),
  requestId: z.string(),
})

export const serverRoomRemovedSchema = z.object({
  type: z.literal('server:room_removed'),
  roomId: z.string(),
})

export const serverErrorSchema = z.object({
  type: z.literal('server:error'),
  code: z.string(),
  message: z.string(),
})

export const serverPongSchema = z.object({
  type: z.literal('server:pong'),
  ts: z.number(),
})

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverAuthResultSchema,
  serverNewMessageSchema,
  serverMessageChunkSchema,
  serverMessageCompleteSchema,
  serverServiceAgentResponseSchema,
  serverMessageEditedSchema,
  serverMessageDeletedSchema,
  serverTypingSchema,
  serverAgentStatusSchema,
  serverTaskUpdateSchema,
  serverRoomUpdateSchema,
  serverRoomRemovedSchema,
  serverTerminalDataSchema,
  serverReadReceiptSchema,
  serverPresenceSchema,
  serverReactionUpdateSchema,
  serverPermissionRequestSchema,
  serverPermissionRequestExpiredSchema,
  serverPongSchema,
  serverErrorSchema,
])

// ─── Server → Gateway Messages ───

export const serverGatewayAuthResultSchema = z.object({
  type: z.literal('server:gateway_auth_result'),
  ok: z.boolean(),
  error: z.string().optional(),
})

export const serverSendToAgentSchema = z.object({
  type: z.literal('server:send_to_agent'),
  agentId: z.string(),
  roomId: z.string(),
  messageId: z.string(),
  content: z.string(),
  senderName: z.string(),
  senderType: z.enum(SENDER_TYPES),
  routingMode: z.enum(ROUTING_MODES),
  conversationId: z.string(),
  depth: z.number().int().min(0),
})

export const serverRoomContextSchema = z.object({
  type: z.literal('server:room_context'),
  agentId: z.string(),
  context: roomContextSchema,
})

export const serverStopAgentSchema = z.object({
  type: z.literal('server:stop_agent'),
  agentId: z.string(),
})

export const serverRemoveAgentSchema = z.object({
  type: z.literal('server:remove_agent'),
  agentId: z.string(),
})

export const serverPermissionResponseSchema = z.object({
  type: z.literal('server:permission_response'),
  requestId: z.string(),
  agentId: z.string(),
  decision: z.enum(PERMISSION_DECISIONS),
})

export const serverGatewayMessageSchema = z.discriminatedUnion('type', [
  serverGatewayAuthResultSchema,
  serverSendToAgentSchema,
  serverStopAgentSchema,
  serverRemoveAgentSchema,
  serverRoomContextSchema,
  serverPermissionResponseSchema,
  serverPongSchema,
])
