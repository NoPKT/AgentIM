import { z } from 'zod'
import {
  AGENT_TYPES,
  AGENT_STATUSES,
  AGENT_VISIBILITIES,
  AGENT_CONNECTION_TYPES,
  AGENT_COMMAND_ROLES,
  AGENT_COMMAND_SOURCES,
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
  MAX_TOOL_INPUT_SIZE,
  DANGEROUS_KEY_NAMES,
  MEMBER_TYPES,
  SENDER_TYPES,
  ASSIGNEE_TYPES,
  NOTIFICATION_PREFS,
  PERMISSION_DECISIONS,
  PERMISSION_TIMEOUT_MS,
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
  // Intentionally shallow: only checks top-level keys. Nested objects are
  // not validated here because tool_input values are opaque JSON passed to
  // agent tooling and never used as property accessors on the server side.
  .refine(
    (obj) => !Object.keys(obj).some((k) => (DANGEROUS_KEY_NAMES as readonly string[]).includes(k)),
    'validation.toolInputDangerousKey',
  )
  .refine(
    (obj) => JSON.stringify(obj).length <= MAX_TOOL_INPUT_SIZE,
    'validation.toolInputTooLarge',
  )

// ─── Password Complexity ───

const COMMON_PASSWORD_WORDS = [
  'password',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'login',
  'master',
  'dragon',
  'monkey',
  'shadow',
  'sunshine',
  'trustno1',
  'iloveyou',
  'football',
  'baseball',
  'soccer',
  'hockey',
  'batman',
  'access',
  'hello',
  'charlie',
  'donald',
  'loveme',
  'michael',
  'mustang',
  'passw0rd',
]

/** Detect 4+ sequential ascending/descending characters or 4+ repeated characters. */
function hasSequentialPattern(pw: string): boolean {
  const lower = pw.toLowerCase()
  for (let i = 0; i <= lower.length - 4; i++) {
    const c0 = lower.charCodeAt(i)
    const c1 = lower.charCodeAt(i + 1)
    const c2 = lower.charCodeAt(i + 2)
    const c3 = lower.charCodeAt(i + 3)
    // Ascending sequence
    if (c1 === c0 + 1 && c2 === c0 + 2 && c3 === c0 + 3) return true
    // Descending sequence
    if (c1 === c0 - 1 && c2 === c0 - 2 && c3 === c0 - 3) return true
    // Repeated characters
    if (c0 === c1 && c1 === c2 && c2 === c3) return true
  }
  return false
}

const passwordSchema = z
  .string()
  .min(8, 'validation.passwordMinLength')
  .max(128, 'validation.passwordMaxLength')
  .refine((p) => /[a-z]/.test(p), 'validation.passwordLowercase')
  .refine((p) => /[A-Z]/.test(p), 'validation.passwordUppercase')
  .refine((p) => /[0-9]/.test(p), 'validation.passwordDigit')
  .refine(
    (p) => !COMMON_PASSWORD_WORDS.some((w) => p.toLowerCase().includes(w)),
    'validation.passwordCommonWord',
  )
  .refine((p) => !hasSequentialPattern(p), 'validation.passwordSequential')

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
    description: z.string().max(MAX_ROUTER_DESCRIPTION_LENGTH).nullable().optional(),
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
        message: 'validation.visibilityListRequired',
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
        message: 'validation.visibilityListRequired',
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

export const searchMessagesSchema = z
  .object({
    q: z.string().min(2).max(500),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    roomId: z.string().max(100).optional(),
    senderId: z.string().max(100).optional(),
    senderType: z.enum(SENDER_TYPES).optional(),
    dateFrom: z.string().datetime({ offset: true }).optional(),
    dateTo: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.dateFrom && data.dateTo && new Date(data.dateFrom) >= new Date(data.dateTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validation.dateFromBeforeDateTo',
        path: ['dateFrom'],
      })
    }
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
  dueDate: z.string().datetime().optional(),
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
  result: z.string().max(100000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().max(100).nullable().optional(),
  assigneeType: z.enum(ASSIGNEE_TYPES).nullable().optional(),
})

// ─── Agent ───

export const agentSlashCommandSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  usage: z.string().max(500),
  source: z.enum(AGENT_COMMAND_SOURCES),
})

export const updateAgentSchema = z.object({
  visibility: z.enum(AGENT_VISIBILITIES).optional(),
  name: z
    .string()
    .min(1)
    .max(MAX_DISPLAY_NAME_LENGTH)
    .refine((s) => s.trim().length > 0, 'validation.nameWhitespace')
    .optional(),
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
        message: 'validation.serviceAgentApiKeyRequired',
        path: ['config', 'apiKey'],
      })
    }
    // Validate provider-specific required config fields
    const MODEL_REQUIRED_TYPES: readonly string[] = [
      'openai-chat',
      'openai-image',
      'perplexity',
      'runway',
      'meshy',
    ]
    if (MODEL_REQUIRED_TYPES.includes(data.type)) {
      if (!data.config.model) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'validation.serviceAgentModelRequired',
          path: ['config', 'model'],
        })
      }
    }
    if (data.type === 'elevenlabs') {
      if (!data.config.voiceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'validation.serviceAgentVoiceIdRequired',
          path: ['config', 'voiceId'],
        })
      }
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
  config: serviceAgentConfigSchema.optional(),
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

/** Maximum serialized size for metadata values (100 KB). */
const MAX_METADATA_VALUE_SIZE = 100_000

const parsedChunkSchema = z.object({
  type: z.enum(CHUNK_TYPES),
  content: z.string().max(1_000_000),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length <= 50, 'validation.metadataTooManyKeys')
    .refine(
      (obj) => JSON.stringify(obj).length <= MAX_METADATA_VALUE_SIZE,
      'validation.metadataTooLarge',
    )
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

export const clientAgentCommandSchema = z.object({
  type: z.literal('client:agent_command'),
  agentId: z.string().min(1),
  roomId: z.string().min(1),
  command: z.string().min(1).max(100),
  args: z.string().max(10_000).default(''),
})

export const clientQueryAgentInfoSchema = z.object({
  type: z.literal('client:query_agent_info'),
  agentId: z.string().min(1),
})

export const clientRequestWorkspaceSchema = z.object({
  type: z.literal('client:request_workspace'),
  roomId: z.string().min(1),
  agentId: z.string().min(1),
  request: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('status') }),
    z.object({ kind: z.literal('tree'), path: z.string().max(4096).optional() }),
    z.object({ kind: z.literal('file'), path: z.string().min(1).max(4096) }),
  ]),
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
  clientAgentCommandSchema,
  clientQueryAgentInfoSchema,
  clientRequestWorkspaceSchema,
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
  ephemeral: z.boolean().optional(),
})

export const gatewayRegisterAgentSchema = z.object({
  type: z.literal('gateway:register_agent'),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(AGENT_TYPES),
    workingDirectory: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    slashCommands: z.array(agentSlashCommandSchema).max(100).optional(),
    mcpServers: z.array(z.string().max(200)).max(100).optional(),
    model: z.string().max(200).optional(),
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
  queueDepth: z.number().int().min(0).optional(),
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
  result: z.string().max(100000).optional(),
})

export const gatewayPermissionRequestSchema = z.object({
  type: z.literal('gateway:permission_request'),
  requestId: z.string().min(1).max(100),
  agentId: z.string().min(1),
  roomId: z.string().min(1),
  toolName: z.string().min(1).max(200),
  toolInput: toolInputSchema,
  timeoutMs: z.number().int().min(1000).max(PERMISSION_TIMEOUT_MS),
})

export const gatewayAgentCommandResultSchema = z.object({
  type: z.literal('gateway:agent_command_result'),
  agentId: z.string().min(1),
  roomId: z.string().min(1),
  command: z.string().min(1).max(100),
  success: z.boolean(),
  message: z.string().max(10_000).optional(),
})

export const gatewayAgentInfoSchema = z.object({
  type: z.literal('gateway:agent_info'),
  agentId: z.string().min(1),
  slashCommands: z.array(agentSlashCommandSchema).max(100),
  mcpServers: z.array(z.string().max(200)).max(100),
  model: z.string().max(200).optional(),
})

export const gatewaySpawnResultSchema = z.object({
  type: z.literal('gateway:spawn_result'),
  requestId: z.string().min(1),
  success: z.boolean(),
  agentId: z.string().optional(),
  error: z.string().optional(),
})

export const gatewayWorkspaceResponseSchema = z.object({
  type: z.literal('gateway:workspace_response'),
  agentId: z.string().min(1),
  requestId: z.string().min(1),
  response: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('status'), data: z.record(z.string(), z.unknown()).nullable() }),
    z.object({
      kind: z.literal('tree'),
      path: z.string(),
      entries: z.array(
        z.object({
          name: z.string(),
          type: z.enum(['file', 'directory']),
          size: z.number().optional(),
        }),
      ),
    }),
    z.object({
      kind: z.literal('file'),
      path: z.string(),
      content: z.string(),
      size: z.number(),
      truncated: z.boolean(),
    }),
    z.object({ kind: z.literal('error'), message: z.string() }),
  ]),
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
  gatewayAgentCommandResultSchema,
  gatewayAgentInfoSchema,
  gatewaySpawnResultSchema,
  gatewayWorkspaceResponseSchema,
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
  slashCommands: z.array(agentSlashCommandSchema).optional(),
  mcpServers: z.array(z.string()).optional(),
  model: z.string().optional(),
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
  totpEnabled: z.boolean().optional(),
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

export const serverTypingSchema = z.object({
  type: z.literal('server:typing'),
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
})

export const serverAgentStatusSchema = z.object({
  type: z.literal('server:agent_status'),
  agent: agentSchema.pick({
    id: true,
    name: true,
    type: true,
    status: true,
    slashCommands: true,
    mcpServers: true,
    model: true,
  }),
})

export const serverAgentCommandResultSchema = z.object({
  type: z.literal('server:agent_command_result'),
  agentId: z.string(),
  roomId: z.string(),
  command: z.string(),
  success: z.boolean(),
  message: z.string().optional(),
})

export const serverAgentInfoSchema = z.object({
  type: z.literal('server:agent_info'),
  agent: agentSchema,
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

export const serverRoomClearedSchema = z.object({
  type: z.literal('server:room_cleared'),
  roomId: z.string().min(1),
  clearedAt: z.string().min(1),
})

export const serverSpawnResultSchema = z.object({
  type: z.literal('server:spawn_result'),
  requestId: z.string().min(1),
  gatewayId: z.string().min(1),
  success: z.boolean(),
  agentId: z.string().optional(),
  error: z.string().optional(),
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
  serverMessageEditedSchema,
  serverMessageDeletedSchema,
  serverTypingSchema,
  serverAgentStatusSchema,
  serverAgentCommandResultSchema,
  serverAgentInfoSchema,
  serverTaskUpdateSchema,
  serverRoomUpdateSchema,
  serverRoomRemovedSchema,
  serverTerminalDataSchema,
  serverReadReceiptSchema,
  serverPresenceSchema,
  serverReactionUpdateSchema,
  serverPermissionRequestSchema,
  serverPermissionRequestExpiredSchema,
  serverRoomClearedSchema,
  serverSpawnResultSchema,
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

export const serverAgentCommandSchema = z.object({
  type: z.literal('server:agent_command'),
  agentId: z.string(),
  roomId: z.string(),
  command: z.string(),
  args: z.string(),
  userId: z.string(),
})

export const serverQueryAgentInfoSchema = z.object({
  type: z.literal('server:query_agent_info'),
  agentId: z.string(),
})

export const serverPermissionResponseSchema = z.object({
  type: z.literal('server:permission_response'),
  requestId: z.string(),
  agentId: z.string(),
  decision: z.enum(PERMISSION_DECISIONS),
})

export const serverSpawnAgentSchema = z.object({
  type: z.literal('server:spawn_agent'),
  requestId: z.string().min(1),
  agentType: z.enum(AGENT_TYPES),
  name: z.string().min(1).max(100),
  workingDirectory: z.string().optional(),
})

export const serverRequestWorkspaceSchema = z.object({
  type: z.literal('server:request_workspace'),
  agentId: z.string().min(1),
  roomId: z.string().min(1),
  requestId: z.string().min(1),
  request: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('status') }),
    z.object({ kind: z.literal('tree'), path: z.string().max(4096).optional() }),
    z.object({ kind: z.literal('file'), path: z.string().min(1).max(4096) }),
  ]),
})

export const serverGatewayMessageSchema = z.discriminatedUnion('type', [
  serverGatewayAuthResultSchema,
  serverSendToAgentSchema,
  serverStopAgentSchema,
  serverRemoveAgentSchema,
  serverRoomContextSchema,
  serverPermissionResponseSchema,
  serverAgentCommandSchema,
  serverQueryAgentInfoSchema,
  serverSpawnAgentSchema,
  serverRequestWorkspaceSchema,
  serverPongSchema,
  serverErrorSchema,
])

// ─── TOTP Validators ───

export const totpCodeSchema = z
  .string()
  .length(6)
  .regex(/^\d{6}$/)

export const totpSetupVerifySchema = z.object({ code: totpCodeSchema })

export const totpVerifyLoginSchema = z.object({
  totpToken: z.string().min(1).max(2000),
  code: z.string().min(1).max(20),
})

export const disableTotpSchema = z.object({ password: z.string().min(1) })
