import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  integer,
  boolean,
  index,
  uniqueIndex,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core'

/** Shorthand for a timestamptz column that returns/accepts ISO strings. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

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
    lockedUntil: ts('locked_until'),
    // Per-user connection limits (null = use global default from config)
    maxWsConnections: integer('max_ws_connections'),
    maxGateways: integer('max_gateways'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
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
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (table) => [
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_hash_idx').on(table.tokenHash),
    index('refresh_tokens_expires_idx').on(table.expiresAt),
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
    connectedAt: ts('connected_at'),
    disconnectedAt: ts('disconnected_at'),
    createdAt: ts('created_at').notNull(),
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
    capabilities: jsonb('capabilities').$type<string[] | null>(),
    connectionType: text('connection_type').notNull().default('cli'), // 'cli' | 'api'
    lastSeenAt: ts('last_seen_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (table) => [
    index('agents_gateway_idx').on(table.gatewayId),
    index('agents_status_idx').on(table.status),
    index('agents_visibility_idx').on(table.visibility),
    index('agents_last_seen_idx').on(table.lastSeenAt),
  ],
)

// ─── Service Agents ───

export const serviceAgents = pgTable('service_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('openai-chat'),
  category: text('category').notNull().default('chat'),
  description: text('description'),
  status: text('status').notNull().default('active'),
  configEncrypted: text('config_encrypted').notNull(),
  avatarUrl: text('avatar_url'),
  createdById: text('created_by_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at')
    .notNull()
    .default(sql`now()`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`now()`),
})

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
    visibilityList: jsonb('visibility_list').notNull().default([]).$type<string[]>(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
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
    agentCommandRole: text('agent_command_role').notNull().default('member'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
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
    pinnedAt: ts('pinned_at'),
    archivedAt: ts('archived_at'),
    lastReadAt: ts('last_read_at'),
    joinedAt: ts('joined_at').notNull(),
  },
  (table) => [
    index('room_members_room_idx').on(table.roomId),
    index('room_members_member_idx').on(table.memberId),
    index('room_members_member_room_idx').on(table.memberId, table.roomId),
    index('room_members_room_type_idx').on(table.roomId, table.memberType),
    index('room_members_member_type_idx').on(table.memberId, table.memberType),
    uniqueIndex('room_members_unique_idx').on(table.roomId, table.memberId),
    index('room_members_pinned_idx').on(table.memberId, table.pinnedAt),
    index('room_members_archived_idx').on(table.memberId, table.archivedAt),
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
    mentions: jsonb('mentions').notNull().default([]).$type<string[]>(),
    chunks: jsonb('chunks').$type<unknown[] | null>(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at'),
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
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull(),
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
    createdAt: ts('created_at').notNull(),
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
    editedAt: ts('edited_at').notNull(),
  },
  (table) => [
    index('message_edits_message_idx').on(table.messageId),
    index('message_edits_message_edited_idx').on(table.messageId, table.editedAt),
  ],
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
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
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

// ─── Settings ───

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: ts('updated_at').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

// ─── Push Subscriptions ───

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (table) => [
    index('push_subscriptions_user_idx').on(table.userId),
    uniqueIndex('push_subscriptions_endpoint_idx').on(table.endpoint),
  ],
)

// ─── Bookmarks ───

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    note: text('note').default(''),
    createdAt: text('created_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('bookmarks_user_idx').on(table.userId),
    index('bookmarks_created_at_idx').on(table.userId, table.createdAt),
    uniqueIndex('bookmarks_user_message_unique').on(table.userId, table.messageId),
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
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    ipAddress: text('ip_address'),
    createdAt: ts('created_at').notNull(),
  },
  (table) => [
    index('audit_logs_user_idx').on(table.userId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_target_idx').on(table.targetId, table.targetType),
  ],
)
