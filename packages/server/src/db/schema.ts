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
  ],
)

// ─── Rooms ───

export const rooms = pgTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('group'),
  broadcastMode: boolean('broadcast_mode').notNull().default(false),
  systemPrompt: text('system_prompt'),
  createdById: text('created_by_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

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
  (table) => [index('attachments_message_idx').on(table.messageId)],
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
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('tasks_room_idx').on(table.roomId),
    index('tasks_assignee_idx').on(table.assigneeId),
    index('tasks_status_idx').on(table.status),
  ],
)
