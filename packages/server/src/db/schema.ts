import { pgTable, text, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'

// ─── Users ───

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: text('role').notNull().default('user'), // 'admin' | 'user'
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    // Per-user connection limits (null = use global default from config)
    maxWsConnections: integer('max_ws_connections'),
    maxGateways: integer('max_gateways'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('users_username_idx').on(table.username)],
)

// ─── Refresh Tokens ───

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_hash_idx').on(table.tokenHash),
  ],
)

// ─── Gateways ───

export const gateways = pgTable(
  'gateways',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hostname: text('hostname'),
    platform: text('platform'),
    arch: text('arch'),
    nodeVersion: text('node_version'),
    connectedAt: text('connected_at'),
    disconnectedAt: text('disconnected_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('gateways_user_idx').on(table.userId)],
)

// ─── Agents ───

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('offline'),
    visibility: text('visibility').notNull().default('private'), // 'private' | 'shared'
    gatewayId: text('gateway_id')
      .notNull()
      .references(() => gateways.id, { onDelete: 'cascade' }),
    workingDirectory: text('working_directory'),
    capabilities: text('capabilities'), // JSON array string, e.g. '["code","debug"]'
    connectionType: text('connection_type').notNull().default('cli'), // 'cli' | 'api'
    lastSeenAt: text('last_seen_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('agents_gateway_idx').on(table.gatewayId),
    index('agents_status_idx').on(table.status),
    index('agents_visibility_idx').on(table.visibility),
    index('agents_last_seen_idx').on(table.lastSeenAt),
  ],
)

// ─── Routers ───

export const routers = pgTable(
  'routers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    scope: text('scope').notNull().default('personal'), // 'global' | 'personal'
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // LLM config
    llmBaseUrl: text('llm_base_url').notNull(),
    llmApiKey: text('llm_api_key').notNull(),
    llmModel: text('llm_model').notNull(),
    // Routing protection
    maxChainDepth: integer('max_chain_depth').notNull().default(5),
    rateLimitWindow: integer('rate_limit_window').notNull().default(60),
    rateLimitMax: integer('rate_limit_max').notNull().default(20),
    // Visibility (for global routers)
    visibility: text('visibility').notNull().default('all'),
    visibilityList: text('visibility_list').notNull().default('[]'), // JSON array of user IDs
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('routers_created_by_idx').on(table.createdById),
    index('routers_scope_idx').on(table.scope),
    index('routers_scope_creator_idx').on(table.scope, table.createdById),
  ],
)

// ─── Rooms ───

export const rooms = pgTable(
  'rooms',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull().default('group'),
    broadcastMode: boolean('broadcast_mode').notNull().default(false),
    systemPrompt: text('system_prompt'),
    routerId: text('router_id').references(() => routers.id, { onDelete: 'set null' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('rooms_created_by_idx').on(table.createdById),
    index('rooms_router_idx').on(table.routerId),
  ],
)

// ─── Room Members ───

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(),
    memberType: text('member_type').notNull(), // 'user' | 'agent'
    role: text('role').notNull().default('member'),
    roleDescription: text('role_description'),
    notificationPref: text('notification_pref').notNull().default('all'), // 'all' | 'mentions' | 'none'
    pinnedAt: text('pinned_at'),
    archivedAt: text('archived_at'),
    lastReadAt: text('last_read_at'),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [
    index('room_members_room_idx').on(table.roomId),
    index('room_members_member_idx').on(table.memberId),
    index('room_members_member_room_idx').on(table.memberId, table.roomId),
    index('room_members_room_type_idx').on(table.roomId, table.memberType),
    index('room_members_member_type_idx').on(table.memberId, table.memberType),
    uniqueIndex('room_members_unique_idx').on(table.roomId, table.memberId),
  ],
)

// ─── Messages ───

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    senderId: text('sender_id').notNull(),
    senderType: text('sender_type').notNull(), // 'user' | 'agent' | 'system'
    senderName: text('sender_name').notNull(),
    type: text('type').notNull().default('text'),
    content: text('content').notNull(),
    replyToId: text('reply_to_id'),
    mentions: text('mentions').notNull().default('[]'), // JSON array of IDs
    chunks: text('chunks'), // JSON array of ParsedChunk for agent responses
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (table) => [
    index('messages_room_idx').on(table.roomId),
    index('messages_room_created_idx').on(table.roomId, table.createdAt),
    index('messages_sender_idx').on(table.senderId),
    index('messages_reply_to_idx').on(table.replyToId),
    index('messages_updated_at_idx').on(table.updatedAt),
  ],
)

// ─── Message Attachments ───

export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    uploadedBy: text('uploaded_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('attachments_message_idx').on(table.messageId),
    index('attachments_uploaded_by_idx').on(table.uploadedBy),
  ],
)

// ─── Message Reactions ───

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('reactions_message_idx').on(table.messageId),
    uniqueIndex('reactions_unique_idx').on(table.messageId, table.userId, table.emoji),
  ],
)

// ─── Message Edits (edit history) ───

export const messageEdits = pgTable(
  'message_edits',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    previousContent: text('previous_content').notNull(),
    editedAt: text('edited_at').notNull(),
  },
  (table) => [index('message_edits_message_idx').on(table.messageId)],
)

// ─── Tasks ───

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('pending'),
    assigneeId: text('assignee_id'),
    assigneeType: text('assignee_type'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('tasks_room_idx').on(table.roomId),
    index('tasks_assignee_idx').on(table.assigneeId),
    index('tasks_status_idx').on(table.status),
    index('tasks_created_by_idx').on(table.createdById),
    index('tasks_room_status_idx').on(table.roomId, table.status),
    index('tasks_updated_at_idx').on(table.updatedAt),
  ],
)

// ─── Audit Logs ───

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // 'login' | 'logout' | 'password_change' | 'user_create' | 'user_update' | 'user_delete' | 'router_create' | 'router_update' | 'router_delete'
    targetId: text('target_id'),
    targetType: text('target_type'), // 'user' | 'router' | 'room'
    metadata: text('metadata'), // JSON string
    ipAddress: text('ip_address'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('audit_logs_user_idx').on(table.userId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_target_idx').on(table.targetId, table.targetType),
  ],
)
