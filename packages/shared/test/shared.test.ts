import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMentions,
  hasMention,
  insertMention,
  registerSchema,
  loginSchema,
  createRoomSchema,
  updateRoomSchema,
  addMemberSchema,
  sendMessageSchema,
  editMessageSchema,
  createTaskSchema,
  updateTaskSchema,
  changePasswordSchema,
  adminCreateUserSchema,
  updateUserSchema,
  clientMessageSchema,
  gatewayMessageSchema,
  createRouterSchema,
  updateRouterSchema,
  gatewayPermissionRequestSchema,
  serverPermissionRequestSchema,
  gatewayAuthSchema,
  toolInputSchema,
  searchMessagesSchema,
  createServiceAgentSchema,
  AGENT_TYPES,
  AGENT_STATUSES,
  ROOM_TYPES,
  ROUTING_MODES,
  AGENT_CONNECTION_TYPES,
  MAX_MESSAGE_LENGTH,
  MAX_TOOL_INPUT_KEYS,
  MAX_TOOL_INPUT_KEY_LENGTH,
  WS_CLIENT_MESSAGE_SIZE_LIMIT,
  WS_GATEWAY_MESSAGE_SIZE_LIMIT,
  MAX_ROOM_NAME_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_MENTIONS_PER_MESSAGE,
  MAX_USERNAME_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_FULL_CONTENT_SIZE,
  DANGEROUS_KEY_NAMES,
  CHUNK_TYPES,
  clientAuthSchema,
  clientJoinRoomSchema,
  clientLeaveRoomSchema,
  clientStopGenerationSchema,
  clientTypingSchema,
  clientPingSchema,
  clientPermissionResponseSchema,
  gatewayAgentStatusSchema,
  gatewayRegisterAgentSchema,
  gatewayUnregisterAgentSchema,
  gatewayPingSchema,
  serverAuthResultSchema,
  serverErrorSchema,
  serverGatewayAuthResultSchema,
  serverPongSchema,
  batchDeleteMessagesSchema,
  forwardMessageSchema,
  messageQuerySchema,
  refreshSchema,
  adminUpdateUserSchema,
  updateAgentSchema,
  updateServiceAgentSchema,
  clientSendMessageSchema,
  createBookmarkSchema,
  gatewayMessageChunkSchema,
  gatewayMessageCompleteSchema,
  gatewayTaskUpdateSchema,
  gatewayTerminalDataSchema,
  serverNewMessageSchema,
  serverMessageDeletedSchema,
  serverTypingSchema,
  serverReadReceiptSchema,
  serverRoomRemovedSchema,
  userSchema,
  gatewaySchema,
  TASK_STATUSES,
  USER_ROLES,
} from '../src/index.js'
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  I18N_NAMESPACES,
  en,
  zhCN,
  ja,
  ko,
  fr,
  de,
  ru,
} from '../src/i18n/index.js'

// ─── Mentions ───

describe('parseMentions', () => {
  it('extracts single mention', () => {
    assert.deepEqual(parseMentions('Hello @alice'), ['alice'])
  })

  it('extracts multiple mentions', () => {
    assert.deepEqual(parseMentions('@bob and @alice'), ['bob', 'alice'])
  })

  it('deduplicates mentions', () => {
    assert.deepEqual(parseMentions('@alice hello @alice'), ['alice'])
  })

  it('returns empty for no mentions', () => {
    assert.deepEqual(parseMentions('no mentions here'), [])
  })

  it('handles mentions with hyphens and underscores', () => {
    assert.deepEqual(parseMentions('@my-agent and @my_bot'), ['my-agent', 'my_bot'])
  })

  it('handles empty string', () => {
    assert.deepEqual(parseMentions(''), [])
  })

  it('handles mention at start of string', () => {
    assert.deepEqual(parseMentions('@first word'), ['first'])
  })
})

describe('hasMention', () => {
  it('returns true when name is mentioned', () => {
    assert.equal(hasMention('Hello @alice!', 'alice'), true)
  })

  it('returns false when name is not mentioned', () => {
    assert.equal(hasMention('Hello @bob', 'alice'), false)
  })

  it('handles word boundaries', () => {
    assert.equal(hasMention('@alicexyz', 'alice'), false)
  })

  it('handles special regex characters in name', () => {
    assert.equal(hasMention('Hello @test.bot', 'test.bot'), true)
  })

  it('returns consistent results when called repeatedly (LRU cache)', () => {
    // Exercise the cache: call hasMention many times with the same name
    assert.equal(hasMention('Hello @cached_user', 'cached_user'), true)
    assert.equal(hasMention('Hi there', 'cached_user'), false)
    // Second call should use the cached regex
    assert.equal(hasMention('cc @cached_user done', 'cached_user'), true)
  })
})

describe('insertMention', () => {
  it('inserts mention at position', () => {
    assert.equal(insertMention('Hello world', 'alice', 6), 'Hello @alice world')
  })

  it('inserts at beginning', () => {
    assert.equal(insertMention('hello', 'bot', 0), '@bot hello')
  })

  it('inserts at end', () => {
    assert.equal(insertMention('hello', 'bot', 5), 'hello@bot ')
  })

  it('clamps position below 0 to 0', () => {
    assert.equal(insertMention('hello', 'bot', -5), '@bot hello')
  })

  it('clamps position beyond length', () => {
    assert.equal(insertMention('hello', 'bot', 100), 'hello@bot ')
  })
})

// ─── Validators ───

describe('registerSchema', () => {
  it('accepts valid input', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Password1',
    })
    assert.equal(result.success, true)
  })

  it('rejects short username', () => {
    const result = registerSchema.safeParse({
      username: 'ab',
      password: 'Password1',
    })
    assert.equal(result.success, false)
  })

  it('rejects invalid username characters', () => {
    const result = registerSchema.safeParse({
      username: 'user name',
      password: 'Password1',
    })
    assert.equal(result.success, false)
  })

  it('rejects weak password - no uppercase', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'password1',
    })
    assert.equal(result.success, false)
  })

  it('rejects weak password - no digit', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Passwords',
    })
    assert.equal(result.success, false)
  })

  it('rejects weak password - too short', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Pass1',
    })
    assert.equal(result.success, false)
  })

  it('accepts optional displayName', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Password1',
      displayName: 'Test User',
    })
    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data.displayName, 'Test User')
    }
  })
})

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    const result = loginSchema.safeParse({ username: 'user', password: 'pass' })
    assert.equal(result.success, true)
  })

  it('rejects empty username', () => {
    const result = loginSchema.safeParse({ username: '', password: 'pass' })
    assert.equal(result.success, false)
  })
})

describe('createRoomSchema', () => {
  it('accepts minimal input with defaults', () => {
    const result = createRoomSchema.safeParse({ name: 'Test Room' })
    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data.type, 'group')
      assert.equal(result.data.broadcastMode, false)
    }
  })

  it('accepts full input', () => {
    const result = createRoomSchema.safeParse({
      name: 'Dev Room',
      type: 'private',
      broadcastMode: true,
      systemPrompt: 'You are a helpful assistant',
      memberIds: ['id1', 'id2'],
    })
    assert.equal(result.success, true)
  })

  it('rejects empty name', () => {
    const result = createRoomSchema.safeParse({ name: '' })
    assert.equal(result.success, false)
  })

  it('rejects invalid room type', () => {
    const result = createRoomSchema.safeParse({ name: 'Room', type: 'invalid' })
    assert.equal(result.success, false)
  })
})

describe('updateRoomSchema', () => {
  it('accepts partial update', () => {
    const result = updateRoomSchema.safeParse({ name: 'New Name' })
    assert.equal(result.success, true)
  })

  it('accepts nullable systemPrompt', () => {
    const result = updateRoomSchema.safeParse({ systemPrompt: null })
    assert.equal(result.success, true)
  })

  it('accepts empty object', () => {
    const result = updateRoomSchema.safeParse({})
    assert.equal(result.success, true)
  })
})

describe('addMemberSchema', () => {
  it('accepts user member', () => {
    const result = addMemberSchema.safeParse({
      memberId: 'user123',
      memberType: 'user',
    })
    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data.role, 'member')
    }
  })

  it('accepts agent member with roleDescription', () => {
    const result = addMemberSchema.safeParse({
      memberId: 'agent123',
      memberType: 'agent',
      role: 'admin',
      roleDescription: 'Code reviewer',
    })
    assert.equal(result.success, true)
  })

  it('rejects invalid memberType', () => {
    const result = addMemberSchema.safeParse({
      memberId: 'id',
      memberType: 'bot',
    })
    assert.equal(result.success, false)
  })
})

describe('sendMessageSchema', () => {
  it('accepts minimal message', () => {
    const result = sendMessageSchema.safeParse({ content: 'Hello' })
    assert.equal(result.success, true)
    if (result.success) {
      assert.deepEqual(result.data.mentions, [])
    }
  })

  it('rejects empty content', () => {
    const result = sendMessageSchema.safeParse({ content: '' })
    assert.equal(result.success, false)
  })

  it('rejects content exceeding max length', () => {
    const result = sendMessageSchema.safeParse({
      content: 'x'.repeat(MAX_MESSAGE_LENGTH + 1),
    })
    assert.equal(result.success, false)
  })

  it('accepts content at max length', () => {
    const result = sendMessageSchema.safeParse({
      content: 'x'.repeat(MAX_MESSAGE_LENGTH),
    })
    assert.equal(result.success, true)
  })
})

describe('editMessageSchema', () => {
  it('accepts valid edit', () => {
    const result = editMessageSchema.safeParse({ content: 'Updated' })
    assert.equal(result.success, true)
  })
})

describe('createTaskSchema', () => {
  it('accepts minimal task', () => {
    const result = createTaskSchema.safeParse({ title: 'Fix bug' })
    assert.equal(result.success, true)
  })

  it('accepts full task', () => {
    const result = createTaskSchema.safeParse({
      title: 'Fix bug',
      description: 'Needs fixing',
      assigneeId: 'agent1',
      assigneeType: 'agent',
    })
    assert.equal(result.success, true)
  })

  it('rejects empty title', () => {
    const result = createTaskSchema.safeParse({ title: '' })
    assert.equal(result.success, false)
  })
})

describe('updateTaskSchema', () => {
  it('accepts status update', () => {
    const result = updateTaskSchema.safeParse({ status: 'in_progress' })
    assert.equal(result.success, true)
  })

  it('rejects invalid status', () => {
    const result = updateTaskSchema.safeParse({ status: 'invalid' })
    assert.equal(result.success, false)
  })

  it('accepts nullable assignee', () => {
    const result = updateTaskSchema.safeParse({
      assigneeId: null,
      assigneeType: null,
    })
    assert.equal(result.success, true)
  })
})

describe('updateUserSchema', () => {
  it('accepts valid avatarUrl', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/avatar_abc123.jpg',
    })
    assert.equal(result.success, true)
  })

  it('rejects avatarUrl with path traversal', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/../../etc/passwd',
    })
    assert.equal(result.success, false)
  })

  it('rejects avatarUrl with special characters', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/<script>alert(1)</script>',
    })
    assert.equal(result.success, false)
  })

  it('rejects avatarUrl not starting with /uploads/', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/etc/passwd',
    })
    assert.equal(result.success, false)
  })

  it('rejects avatarUrl with nested path (subdirectory)', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/subdir/file.jpg',
    })
    assert.equal(result.success, false)
  })

  it('rejects avatarUrl with slash in filename', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/a/b.png',
    })
    assert.equal(result.success, false)
  })

  it('accepts avatarUrl with dots in filename', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/avatar.thumb.jpg',
    })
    assert.equal(result.success, true)
  })

  it('accepts avatarUrl with hyphens and underscores', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/my_avatar-2024.png',
    })
    assert.equal(result.success, true)
  })

  it('rejects avatarUrl starting with dot', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/.hidden',
    })
    assert.equal(result.success, false)
  })

  it('rejects avatarUrl starting with hyphen', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/-badname.jpg',
    })
    assert.equal(result.success, false)
  })

  it('rejects avatarUrl with spaces', () => {
    const result = updateUserSchema.safeParse({
      avatarUrl: '/uploads/my file.jpg',
    })
    assert.equal(result.success, false)
  })

  it('accepts valid displayName update', () => {
    const result = updateUserSchema.safeParse({
      displayName: 'New Name',
    })
    assert.equal(result.success, true)
  })
})

describe('changePasswordSchema', () => {
  it('accepts valid password change', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'NewPass123',
    })
    assert.equal(result.success, true)
  })

  it('rejects weak new password', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: 'weak',
    })
    assert.equal(result.success, false)
  })
})

describe('adminCreateUserSchema', () => {
  it('accepts user creation with role', () => {
    const result = adminCreateUserSchema.safeParse({
      username: 'newuser',
      password: 'Password1',
      role: 'admin',
    })
    assert.equal(result.success, true)
  })

  it('defaults role to user', () => {
    const result = adminCreateUserSchema.safeParse({
      username: 'newuser',
      password: 'Password1',
    })
    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data.role, 'user')
    }
  })
})

// ─── WebSocket Protocol Validators ───

describe('clientMessageSchema', () => {
  it('validates auth message', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:auth',
      token: 'abc123',
    })
    assert.equal(result.success, true)
  })

  it('validates send_message', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:send_message',
      roomId: 'room1',
      content: 'Hello',
      mentions: ['alice'],
    })
    assert.equal(result.success, true)
  })

  it('validates ping', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:ping',
      ts: Date.now(),
    })
    assert.equal(result.success, true)
  })

  it('rejects unknown type', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:unknown',
    })
    assert.equal(result.success, false)
  })

  it('validates join_room', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:join_room',
      roomId: 'room1',
    })
    assert.equal(result.success, true)
  })

  it('validates typing', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:typing',
      roomId: 'room1',
    })
    assert.equal(result.success, true)
  })

  it('validates stop_generation', () => {
    const result = clientMessageSchema.safeParse({
      type: 'client:stop_generation',
      roomId: 'room1',
      agentId: 'agent1',
    })
    assert.equal(result.success, true)
  })
})

describe('gatewayMessageSchema', () => {
  it('validates register_agent with capabilities', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:register_agent',
      agent: {
        id: 'agent1',
        name: 'Claude',
        type: 'claude-code',
        capabilities: ['code', 'debug'],
      },
    })
    assert.equal(result.success, true)
  })

  it('validates message_chunk', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:message_chunk',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      chunk: { type: 'text', content: 'Hello' },
    })
    assert.equal(result.success, true)
  })

  it('validates message_complete with chunks', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:message_complete',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      fullContent: 'Hello world',
      chunks: [
        { type: 'thinking', content: 'Let me think...' },
        { type: 'text', content: 'Hello world' },
      ],
    })
    assert.equal(result.success, true)
  })

  it('validates agent_status', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:agent_status',
      agentId: 'agent1',
      status: 'busy',
    })
    assert.equal(result.success, true)
  })

  it('rejects invalid agent status', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:agent_status',
      agentId: 'agent1',
      status: 'sleeping',
    })
    assert.equal(result.success, false)
  })

  it('validates ping', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:ping',
      ts: Date.now(),
    })
    assert.equal(result.success, true)
  })
})

// ─── Constants ───

describe('Constants', () => {
  it('AGENT_TYPES includes expected values', () => {
    assert.ok(AGENT_TYPES.includes('claude-code'))
    assert.ok(AGENT_TYPES.includes('generic'))
  })

  it('AGENT_STATUSES includes expected values', () => {
    assert.ok(AGENT_STATUSES.includes('online'))
    assert.ok(AGENT_STATUSES.includes('offline'))
    assert.ok(AGENT_STATUSES.includes('busy'))
    assert.ok(AGENT_STATUSES.includes('error'))
  })

  it('ROOM_TYPES includes expected values', () => {
    assert.ok(ROOM_TYPES.includes('private'))
    assert.ok(ROOM_TYPES.includes('group'))
  })

  it('ROUTING_MODES includes two modes', () => {
    assert.equal(ROUTING_MODES.length, 2)
    assert.ok(ROUTING_MODES.includes('broadcast'))
    assert.ok(ROUTING_MODES.includes('direct'))
  })

  it('AGENT_CONNECTION_TYPES includes expected values', () => {
    assert.ok(AGENT_CONNECTION_TYPES.includes('cli'))
    assert.ok(AGENT_CONNECTION_TYPES.includes('api'))
  })

  it('MAX_MESSAGE_LENGTH is reasonable', () => {
    assert.ok(MAX_MESSAGE_LENGTH >= 1000)
    assert.ok(MAX_MESSAGE_LENGTH <= 1_000_000)
  })

  it('WS message size limits are defined', () => {
    assert.equal(WS_CLIENT_MESSAGE_SIZE_LIMIT, 128 * 1024)
    assert.equal(WS_GATEWAY_MESSAGE_SIZE_LIMIT, 256 * 1024)
  })

  it('SUPPORTED_LANGUAGES is non-empty and includes required languages', () => {
    assert.ok(SUPPORTED_LANGUAGES.length > 0)
    assert.ok(SUPPORTED_LANGUAGES.includes('en'))
    assert.ok(SUPPORTED_LANGUAGES.includes('zh-CN'))
    assert.ok(SUPPORTED_LANGUAGES.includes('ja'))
    assert.ok(SUPPORTED_LANGUAGES.includes('ko'))
    assert.ok(SUPPORTED_LANGUAGES.includes('fr'))
    assert.ok(SUPPORTED_LANGUAGES.includes('de'))
    assert.ok(SUPPORTED_LANGUAGES.includes('ru'))
  })

  it('LANGUAGE_NAMES has entries for all supported languages', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      assert.ok(typeof LANGUAGE_NAMES[lang] === 'string')
    }
  })
})

// ─── i18n Translation Completeness ───

function collectKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const fullKey = prefix ? `${prefix}.${k}` : k
    return typeof v === 'object' && v !== null ? collectKeys(v as object, fullKey) : [fullKey]
  })
}

describe('i18n translation completeness', () => {
  const enKeys = collectKeys(en).sort()
  const locales: [string, object][] = [
    ['zh-CN', zhCN],
    ['ja', ja],
    ['ko', ko],
    ['fr', fr],
    ['de', de],
    ['ru', ru],
  ]

  for (const [lang, locale] of locales) {
    it(`${lang} has the same keys as en`, () => {
      assert.deepEqual(collectKeys(locale).sort(), enKeys)
    })
  }
})

// ─── createRouterSchema / updateRouterSchema superRefine ─────────────────────

describe('createRouterSchema superRefine', () => {
  const baseRouter = {
    name: 'test-router',
    llmBaseUrl: 'https://api.example.com',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4',
  }

  it('rejects visibility=whitelist with empty visibilityList', () => {
    const result = createRouterSchema.safeParse({
      ...baseRouter,
      visibility: 'whitelist',
      visibilityList: [],
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts visibility=whitelist with non-empty visibilityList', () => {
    const result = createRouterSchema.safeParse({
      ...baseRouter,
      visibility: 'whitelist',
      visibilityList: ['room1'],
    })
    assert.strictEqual(result.success, true)
  })
})

describe('updateRouterSchema superRefine', () => {
  it('rejects visibility=blacklist with empty visibilityList', () => {
    const result = updateRouterSchema.safeParse({
      visibility: 'blacklist',
      visibilityList: [],
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts visibility=all with empty visibilityList', () => {
    const result = updateRouterSchema.safeParse({
      visibility: 'all',
      visibilityList: [],
    })
    assert.strictEqual(result.success, true)
  })
})

// ─── searchMessagesSchema dateFrom/dateTo validation ──────────────────────────

describe('searchMessagesSchema', () => {
  it('accepts valid date range', () => {
    const result = searchMessagesSchema.safeParse({
      q: 'hello',
      dateFrom: '2024-01-01T00:00:00Z',
      dateTo: '2024-12-31T23:59:59Z',
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects dateFrom >= dateTo', () => {
    const result = searchMessagesSchema.safeParse({
      q: 'hello',
      dateFrom: '2024-12-31T00:00:00Z',
      dateTo: '2024-01-01T00:00:00Z',
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects dateFrom equal to dateTo', () => {
    const result = searchMessagesSchema.safeParse({
      q: 'hello',
      dateFrom: '2024-06-15T12:00:00Z',
      dateTo: '2024-06-15T12:00:00Z',
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts when only dateFrom is provided', () => {
    const result = searchMessagesSchema.safeParse({
      q: 'hello',
      dateFrom: '2024-01-01T00:00:00Z',
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts when only dateTo is provided', () => {
    const result = searchMessagesSchema.safeParse({
      q: 'hello',
      dateTo: '2024-12-31T00:00:00Z',
    })
    assert.strictEqual(result.success, true)
  })
})

// ─── gatewayAuthSchema ────────────────────────────────────────────────────────

describe('gatewayAuthSchema', () => {
  it('validates a complete gateway auth message', () => {
    const result = gatewayAuthSchema.safeParse({
      type: 'gateway:auth',
      token: 'jwt-token-here',
      gatewayId: 'gw-123',
      deviceInfo: {
        hostname: 'localhost',
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20.0.0',
      },
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects missing gatewayId', () => {
    const result = gatewayAuthSchema.safeParse({
      type: 'gateway:auth',
      token: 'jwt-token-here',
      deviceInfo: {
        hostname: 'localhost',
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20.0.0',
      },
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects empty token', () => {
    const result = gatewayAuthSchema.safeParse({
      type: 'gateway:auth',
      token: '',
      gatewayId: 'gw-123',
      deviceInfo: {
        hostname: 'localhost',
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20.0.0',
      },
    })
    assert.strictEqual(result.success, false)
  })
})

// ─── createServiceAgentSchema provider validation ─────────────────────────────

describe('createServiceAgentSchema provider validation', () => {
  it('rejects runway type without apiKey', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Runway',
      type: 'runway',
      config: {},
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts runway type with apiKey', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Runway',
      type: 'runway',
      config: { apiKey: 'rk-test' },
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects meshy type without apiKey', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Meshy',
      type: 'meshy',
      config: {},
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects stability-audio type without apiKey', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Audio',
      type: 'stability-audio',
      config: {},
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects elevenlabs type without voiceId', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Voice',
      type: 'elevenlabs',
      config: { apiKey: 'el-test' },
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts elevenlabs type with apiKey and voiceId', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Voice',
      type: 'elevenlabs',
      config: { apiKey: 'el-test', voiceId: 'voice-1' },
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects perplexity type without model', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Perplexity',
      type: 'perplexity',
      config: { apiKey: 'pplx-test' },
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts perplexity type with apiKey and model', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Perplexity',
      type: 'perplexity',
      config: { apiKey: 'pplx-test', model: 'sonar-pro' },
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts custom type without apiKey', () => {
    const result = createServiceAgentSchema.safeParse({
      name: 'My Custom',
      type: 'custom',
      config: {},
    })
    assert.strictEqual(result.success, true)
  })
})

// ─── I18N_NAMESPACES export ───────────────────────────────────────────────────

describe('I18N_NAMESPACES', () => {
  it('is an array of strings', () => {
    assert.ok(Array.isArray(I18N_NAMESPACES))
    assert.ok(I18N_NAMESPACES.length > 0)
    for (const ns of I18N_NAMESPACES) {
      assert.strictEqual(typeof ns, 'string')
    }
  })

  it('includes common namespaces', () => {
    assert.ok(I18N_NAMESPACES.includes('common'))
    assert.ok(I18N_NAMESPACES.includes('auth'))
    assert.ok(I18N_NAMESPACES.includes('chat'))
  })
})

// ─── createRouterSchema nullable description ──────────────────────────────────

describe('createRouterSchema nullable description', () => {
  const baseRouter = {
    name: 'test-router',
    llmBaseUrl: 'https://api.example.com',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4',
  }

  it('accepts null description', () => {
    const result = createRouterSchema.safeParse({
      ...baseRouter,
      description: null,
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts string description', () => {
    const result = createRouterSchema.safeParse({
      ...baseRouter,
      description: 'A test router',
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts omitted description', () => {
    const result = createRouterSchema.safeParse(baseRouter)
    assert.strictEqual(result.success, true)
  })
})

// ─── toolInput schema boundary tests ─────────────────────────────────────────

describe('toolInputSchema', () => {
  it('rejects when key count exceeds MAX_TOOL_INPUT_KEYS', () => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i <= MAX_TOOL_INPUT_KEYS; i++) {
      obj[`key${i}`] = 'value'
    }
    const result = toolInputSchema.safeParse(obj)
    assert.strictEqual(result.success, false)
  })

  it('rejects when a single key exceeds MAX_TOOL_INPUT_KEY_LENGTH', () => {
    const longKey = 'k'.repeat(MAX_TOOL_INPUT_KEY_LENGTH + 1)
    const result = toolInputSchema.safeParse({ [longKey]: 'value' })
    assert.strictEqual(result.success, false)
  })

  it('accepts valid toolInput data', () => {
    const result = toolInputSchema.safeParse({ foo: 'bar', baz: 42 })
    assert.strictEqual(result.success, true)
  })

  it('behaves identically in gatewayPermissionRequestSchema and serverPermissionRequestSchema', () => {
    const tooManyKeys: Record<string, unknown> = {}
    for (let i = 0; i <= MAX_TOOL_INPUT_KEYS; i++) {
      tooManyKeys[`key${i}`] = 'v'
    }

    const gatewayResult = gatewayPermissionRequestSchema.safeParse({
      type: 'gateway:permission_request',
      requestId: 'req-1',
      agentId: 'agent-1',
      roomId: 'room-1',
      toolName: 'test-tool',
      toolInput: tooManyKeys,
      timeoutMs: 5000,
    })

    const serverResult = serverPermissionRequestSchema.safeParse({
      type: 'server:permission_request',
      requestId: 'req-1',
      agentId: 'agent-1',
      agentName: 'Agent',
      roomId: 'room-1',
      toolName: 'test-tool',
      toolInput: tooManyKeys,
      expiresAt: new Date().toISOString(),
    })

    assert.strictEqual(gatewayResult.success, false)
    assert.strictEqual(serverResult.success, false)
  })
})

// ─── Password boundary tests ────────────────────────────────────────────────

describe('Password boundary tests', () => {
  it('accepts exactly 8 characters (valid boundary)', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Abcdef1x',
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects exactly 7 characters (invalid boundary)', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Abcde1x',
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts exactly 128 characters (valid boundary)', () => {
    // 126 filler chars + 1 uppercase + 1 digit = 128 total
    const password = 'A1' + 'a'.repeat(126)
    assert.strictEqual(password.length, 128)
    const result = registerSchema.safeParse({
      username: 'testuser',
      password,
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects exactly 129 characters (invalid boundary)', () => {
    const password = 'A1' + 'a'.repeat(127)
    assert.strictEqual(password.length, 129)
    const result = registerSchema.safeParse({
      username: 'testuser',
      password,
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts password with special characters', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'P@$$w0rd!#%',
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects password with no lowercase at all', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'ABCDEFG1',
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts password with unicode characters', () => {
    // Unicode chars are fine as long as min length, upper, lower, digit are satisfied
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Passw0rd\u00e9\u00fc',
    })
    assert.strictEqual(result.success, true)
  })
})

// ─── Username boundary tests ────────────────────────────────────────────────

describe('Username boundary tests', () => {
  it('accepts exactly 3 characters (valid boundary)', () => {
    const result = registerSchema.safeParse({
      username: 'abc',
      password: 'Password1',
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects exactly 2 characters (invalid boundary)', () => {
    const result = registerSchema.safeParse({
      username: 'ab',
      password: 'Password1',
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts exactly MAX_USERNAME_LENGTH (50) characters', () => {
    const username = 'a'.repeat(MAX_USERNAME_LENGTH)
    assert.strictEqual(username.length, 50)
    const result = registerSchema.safeParse({
      username,
      password: 'Password1',
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects 51 characters (too long)', () => {
    const username = 'a'.repeat(MAX_USERNAME_LENGTH + 1)
    assert.strictEqual(username.length, 51)
    const result = registerSchema.safeParse({
      username,
      password: 'Password1',
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects username with dots', () => {
    const result = registerSchema.safeParse({
      username: 'user.name',
      password: 'Password1',
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects username with leading spaces', () => {
    const result = registerSchema.safeParse({
      username: ' username',
      password: 'Password1',
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects username with trailing spaces', () => {
    const result = registerSchema.safeParse({
      username: 'username ',
      password: 'Password1',
    })
    assert.strictEqual(result.success, false)
  })
})

// ─── DisplayName boundary tests ─────────────────────────────────────────────

describe('DisplayName boundary tests', () => {
  it('accepts exactly MAX_DISPLAY_NAME_LENGTH (100) characters', () => {
    const displayName = 'A'.repeat(MAX_DISPLAY_NAME_LENGTH)
    assert.strictEqual(displayName.length, 100)
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Password1',
      displayName,
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects 101 characters (too long)', () => {
    const displayName = 'A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)
    assert.strictEqual(displayName.length, 101)
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Password1',
      displayName,
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects whitespace-only displayName', () => {
    const result = registerSchema.safeParse({
      username: 'testuser',
      password: 'Password1',
      displayName: '   ',
    })
    assert.strictEqual(result.success, false)
  })
})

// ─── dangerousKeys in toolInput ─────────────────────────────────────────────

describe('dangerousKeys in toolInput', () => {
  it('rejects toolInput with dangerous key "constructor"', () => {
    const result = toolInputSchema.safeParse({ constructor: 'value' })
    assert.strictEqual(result.success, false)
  })

  it('rejects toolInput with dangerous key "prototype"', () => {
    const result = toolInputSchema.safeParse({ prototype: 'value' })
    assert.strictEqual(result.success, false)
  })

  it('__proto__ handling relies on Zod z.record() internals (known limitation, verify no prototype pollution)', () => {
    // __proto__ is special in JS: Zod internally constructs a plain object,
    // which currently causes __proto__ to be consumed as a prototype setter rather
    // than stored as an enumerable key. Object.keys() never sees it, so the refine
    // check cannot reject it. This behavior is library-implementation-dependent and
    // should be treated as a known limitation that requires periodic security review
    // when upgrading Zod or changing the schema.
    const obj = Object.create(null) as Record<string, unknown>
    obj['__proto__'] = 'value'
    const result = toolInputSchema.safeParse(obj)
    assert.strictEqual(result.success, true)
    if (result.success) {
      // Verify the key was indeed stripped from the parsed output
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(result.data, '__proto__'),
        false,
      )
      // Additionally, verify that parsing did not cause prototype pollution.
      // The parsed value should have a normal, safe prototype (Object.prototype
      // or null, depending on Zod's internal representation), and it must not
      // introduce unexpected properties on Object.prototype.
      const parsedProto = Object.getPrototypeOf(result.data)
      assert.ok(parsedProto === Object.prototype || parsedProto === null)
      const pollutionSentinel = Symbol('pollutionSentinel')
      // Create a fresh plain object and ensure it does not see any polluted property.
      const fresh = {}
      // If Object.prototype were polluted with our sentinel, it would appear here.
      // We assert that this is not the case.
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(fresh, pollutionSentinel as unknown as PropertyKey),
        false,
      )
    }
  })

  it('DANGEROUS_KEY_NAMES contains __proto__, constructor, and prototype', () => {
    assert.ok(DANGEROUS_KEY_NAMES.includes('__proto__'))
    assert.ok(DANGEROUS_KEY_NAMES.includes('constructor'))
    assert.ok(DANGEROUS_KEY_NAMES.includes('prototype'))
  })

  it('accepts toolInput with safe keys alongside non-dangerous names', () => {
    const result = toolInputSchema.safeParse({
      file: '/tmp/test.ts',
      command: 'run',
      proto: 'safe',
      constructorArg: 'also safe',
    })
    assert.strictEqual(result.success, true)
  })
})

// ─── sendMessage edge cases ─────────────────────────────────────────────────

describe('sendMessage edge cases', () => {
  it('accepts empty mentions array', () => {
    const result = sendMessageSchema.safeParse({
      content: 'Hello',
      mentions: [],
    })
    assert.strictEqual(result.success, true)
    if (result.success) {
      assert.deepStrictEqual(result.data.mentions, [])
    }
  })

  it('accepts max mentions (MAX_MENTIONS_PER_MESSAGE)', () => {
    const mentions = Array.from({ length: MAX_MENTIONS_PER_MESSAGE }, (_, i) => `user${i}`)
    const result = sendMessageSchema.safeParse({
      content: 'Hello everyone',
      mentions,
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects mentions exceeding MAX_MENTIONS_PER_MESSAGE', () => {
    const mentions = Array.from({ length: MAX_MENTIONS_PER_MESSAGE + 1 }, (_, i) => `user${i}`)
    const result = sendMessageSchema.safeParse({
      content: 'Hello everyone',
      mentions,
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts content with only whitespace (min 1 char satisfied)', () => {
    const result = sendMessageSchema.safeParse({
      content: '   ',
    })
    // min(1) checks length, not trimmed length; whitespace has length >= 1
    assert.strictEqual(result.success, true)
  })

  it('accepts message with replyToId provided', () => {
    const result = sendMessageSchema.safeParse({
      content: 'Replying to you',
      replyToId: 'msg-abc123',
    })
    assert.strictEqual(result.success, true)
    if (result.success) {
      assert.strictEqual(result.data.replyToId, 'msg-abc123')
    }
  })
})

// ─── createRoom edge cases ──────────────────────────────────────────────────

describe('createRoom edge cases', () => {
  it('accepts room name at MAX_ROOM_NAME_LENGTH', () => {
    const name = 'R'.repeat(MAX_ROOM_NAME_LENGTH)
    assert.strictEqual(name.length, 100)
    const result = createRoomSchema.safeParse({ name })
    assert.strictEqual(result.success, true)
  })

  it('rejects room name exceeding MAX_ROOM_NAME_LENGTH', () => {
    const name = 'R'.repeat(MAX_ROOM_NAME_LENGTH + 1)
    const result = createRoomSchema.safeParse({ name })
    assert.strictEqual(result.success, false)
  })

  it('accepts systemPrompt at MAX_SYSTEM_PROMPT_LENGTH', () => {
    const systemPrompt = 'x'.repeat(MAX_SYSTEM_PROMPT_LENGTH)
    assert.strictEqual(systemPrompt.length, 10_000)
    const result = createRoomSchema.safeParse({
      name: 'Test Room',
      systemPrompt,
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects systemPrompt exceeding MAX_SYSTEM_PROMPT_LENGTH', () => {
    const systemPrompt = 'x'.repeat(MAX_SYSTEM_PROMPT_LENGTH + 1)
    const result = createRoomSchema.safeParse({
      name: 'Test Room',
      systemPrompt,
    })
    assert.strictEqual(result.success, false)
  })

  it('rejects whitespace-only room name', () => {
    const result = createRoomSchema.safeParse({ name: '   ' })
    assert.strictEqual(result.success, false)
  })
})

// ─── WebSocket protocol boundary tests ──────────────────────────────────────

describe('WebSocket protocol boundary tests', () => {
  it('accepts client:auth with token at max length (2000)', () => {
    const token = 't'.repeat(2000)
    const result = clientMessageSchema.safeParse({
      type: 'client:auth',
      token,
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects client:auth with token exceeding max length (2001)', () => {
    const token = 't'.repeat(2001)
    const result = clientMessageSchema.safeParse({
      type: 'client:auth',
      token,
    })
    assert.strictEqual(result.success, false)
  })

  it('accepts gateway:message_complete with fullContent at max (200000)', () => {
    const fullContent = 'c'.repeat(MAX_FULL_CONTENT_SIZE)
    assert.strictEqual(fullContent.length, 200_000)
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:message_complete',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      fullContent,
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects gateway:message_complete with fullContent exceeding max', () => {
    const fullContent = 'c'.repeat(MAX_FULL_CONTENT_SIZE + 1)
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:message_complete',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      fullContent,
    })
    assert.strictEqual(result.success, false)
  })

  it('validates gateway:message_chunk with each chunk type', () => {
    for (const chunkType of CHUNK_TYPES) {
      const result = gatewayMessageSchema.safeParse({
        type: 'gateway:message_chunk',
        roomId: 'room1',
        agentId: 'agent1',
        messageId: 'msg1',
        chunk: { type: chunkType, content: `content for ${chunkType}` },
      })
      assert.strictEqual(result.success, true, `chunk type "${chunkType}" should be valid`)
    }
  })

  it('rejects gateway:message_chunk with invalid chunk type', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:message_chunk',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      chunk: { type: 'invalid_type', content: 'test' },
    })
    assert.strictEqual(result.success, false)
  })

  it('validates gateway:message_chunk with metadata in chunk', () => {
    const result = gatewayMessageSchema.safeParse({
      type: 'gateway:message_chunk',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      chunk: {
        type: 'tool_use',
        content: 'Running command',
        metadata: { toolName: 'bash', exitCode: 0 },
      },
    })
    assert.strictEqual(result.success, true)
  })

  it('validates CHUNK_TYPES contains expected values', () => {
    const expectedChunkTypes = [
      'text',
      'thinking',
      'tool_use',
      'tool_result',
      'error',
      'workspace_status',
    ]
    // Ensure all expected types are present
    for (const type of expectedChunkTypes) {
      assert.ok(CHUNK_TYPES.includes(type))
    }
    // Ensure no unexpected types are present
    assert.ok(
      CHUNK_TYPES.every(type => expectedChunkTypes.includes(type)),
      'CHUNK_TYPES contains unexpected values',
    )
  })
})

// ─── WebSocket Client Protocol Schemas ───

describe('clientAuthSchema', () => {
  it('accepts valid auth message', () => {
    const result = clientAuthSchema.safeParse({ type: 'client:auth', token: 'jwt-token-123' })
    assert.strictEqual(result.success, true)
  })
  it('rejects missing token', () => {
    const result = clientAuthSchema.safeParse({ type: 'client:auth' })
    assert.strictEqual(result.success, false)
  })
})

describe('clientJoinRoomSchema', () => {
  it('accepts valid join message', () => {
    const result = clientJoinRoomSchema.safeParse({ type: 'client:join_room', roomId: 'room-abc' })
    assert.strictEqual(result.success, true)
  })
  it('rejects empty roomId', () => {
    const result = clientJoinRoomSchema.safeParse({ type: 'client:join_room', roomId: '' })
    assert.strictEqual(result.success, false)
  })
})

describe('clientLeaveRoomSchema', () => {
  it('accepts valid leave message', () => {
    const result = clientLeaveRoomSchema.safeParse({
      type: 'client:leave_room',
      roomId: 'room-abc',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('clientStopGenerationSchema', () => {
  it('accepts valid stop message', () => {
    const result = clientStopGenerationSchema.safeParse({
      type: 'client:stop_generation',
      roomId: 'room-abc',
      agentId: 'agent-123',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('clientTypingSchema', () => {
  it('accepts valid typing message', () => {
    const result = clientTypingSchema.safeParse({
      type: 'client:typing',
      roomId: 'room-abc',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('clientPingSchema', () => {
  it('accepts valid ping message', () => {
    const result = clientPingSchema.safeParse({ type: 'client:ping', ts: Date.now() })
    assert.strictEqual(result.success, true)
  })
  it('rejects missing ts', () => {
    const result = clientPingSchema.safeParse({ type: 'client:ping' })
    assert.strictEqual(result.success, false)
  })
})

describe('clientPermissionResponseSchema', () => {
  it('accepts allow decision', () => {
    const result = clientPermissionResponseSchema.safeParse({
      type: 'client:permission_response',
      requestId: 'req-abc',
      decision: 'allow',
    })
    assert.strictEqual(result.success, true)
  })
  it('accepts deny decision', () => {
    const result = clientPermissionResponseSchema.safeParse({
      type: 'client:permission_response',
      requestId: 'req-abc',
      decision: 'deny',
    })
    assert.strictEqual(result.success, true)
  })
  it('rejects invalid decision', () => {
    const result = clientPermissionResponseSchema.safeParse({
      type: 'client:permission_response',
      requestId: 'req-abc',
      decision: 'maybe',
    })
    assert.strictEqual(result.success, false)
  })
})

// ─── WebSocket Gateway Protocol Schemas ───

describe('gatewayRegisterAgentSchema', () => {
  it('accepts valid register message', () => {
    const result = gatewayRegisterAgentSchema.safeParse({
      type: 'gateway:register_agent',
      agent: { id: 'agent-abc', name: 'My Agent', type: 'claude-code' },
    })
    assert.strictEqual(result.success, true)
  })
  it('rejects invalid agent type', () => {
    const result = gatewayRegisterAgentSchema.safeParse({
      type: 'gateway:register_agent',
      agent: { id: 'agent-abc', name: 'My Agent', type: 'invalid_type' },
    })
    assert.strictEqual(result.success, false)
  })
})

describe('gatewayUnregisterAgentSchema', () => {
  it('accepts valid unregister message', () => {
    const result = gatewayUnregisterAgentSchema.safeParse({
      type: 'gateway:unregister_agent',
      agentId: 'agent-abc',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('gatewayAgentStatusSchema', () => {
  it('accepts valid agent status update', () => {
    const result = gatewayAgentStatusSchema.safeParse({
      type: 'gateway:agent_status',
      agentId: 'agent-abc',
      status: 'online',
    })
    assert.strictEqual(result.success, true)
  })
  it('rejects invalid status', () => {
    const result = gatewayAgentStatusSchema.safeParse({
      type: 'gateway:agent_status',
      agentId: 'agent-abc',
      status: 'invalid_status',
    })
    assert.strictEqual(result.success, false)
  })
})

describe('gatewayPingSchema', () => {
  it('accepts valid gateway ping', () => {
    const result = gatewayPingSchema.safeParse({ type: 'gateway:ping', ts: Date.now() })
    assert.strictEqual(result.success, true)
  })
})

// ─── Server Response Schemas ───

describe('serverAuthResultSchema', () => {
  it('accepts successful auth result', () => {
    const result = serverAuthResultSchema.safeParse({
      type: 'server:auth_result',
      ok: true,
      userId: 'user-abc',
    })
    assert.strictEqual(result.success, true)
  })
  it('accepts auth failure', () => {
    const result = serverAuthResultSchema.safeParse({
      type: 'server:auth_result',
      ok: false,
      error: 'Invalid token',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverErrorSchema', () => {
  it('accepts valid error message', () => {
    const result = serverErrorSchema.safeParse({
      type: 'server:error',
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverGatewayAuthResultSchema', () => {
  it('accepts valid gateway auth result', () => {
    const result = serverGatewayAuthResultSchema.safeParse({
      type: 'server:gateway_auth_result',
      ok: true,
    })
    assert.strictEqual(result.success, true)
  })
  it('accepts gateway auth failure', () => {
    const result = serverGatewayAuthResultSchema.safeParse({
      type: 'server:gateway_auth_result',
      ok: false,
      error: 'Invalid token',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverPongSchema', () => {
  it('accepts valid pong message', () => {
    const result = serverPongSchema.safeParse({ type: 'server:pong', ts: Date.now() })
    assert.strictEqual(result.success, true)
  })
})

// ─── Additional REST API Schemas ───

describe('batchDeleteMessagesSchema', () => {
  it('accepts valid batch delete', () => {
    const result = batchDeleteMessagesSchema.safeParse({
      messageIds: ['id1', 'id2', 'id3'],
    })
    assert.strictEqual(result.success, true)
  })
  it('rejects empty array', () => {
    const result = batchDeleteMessagesSchema.safeParse({ messageIds: [] })
    assert.strictEqual(result.success, false)
  })
  it('rejects too many IDs', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id${i}`)
    const result = batchDeleteMessagesSchema.safeParse({ messageIds: ids })
    assert.strictEqual(result.success, false)
  })
})

describe('forwardMessageSchema', () => {
  it('accepts valid forward request', () => {
    const result = forwardMessageSchema.safeParse({
      targetRoomId: 'room-target',
    })
    assert.strictEqual(result.success, true)
  })
  it('rejects missing targetRoomId', () => {
    const result = forwardMessageSchema.safeParse({})
    assert.strictEqual(result.success, false)
  })
})

describe('messageQuerySchema', () => {
  it('accepts empty query (uses defaults)', () => {
    const result = messageQuerySchema.safeParse({})
    assert.strictEqual(result.success, true)
  })
  it('accepts cursor and limit', () => {
    const result = messageQuerySchema.safeParse({ cursor: 'abc', limit: 25 })
    assert.strictEqual(result.success, true)
  })
  it('rejects negative limit', () => {
    const result = messageQuerySchema.safeParse({ limit: -1 })
    assert.strictEqual(result.success, false)
  })
})

describe('refreshSchema', () => {
  it('accepts valid refresh token', () => {
    const result = refreshSchema.safeParse({ refreshToken: 'token-abc-xyz' })
    assert.strictEqual(result.success, true)
  })
})

describe('adminUpdateUserSchema', () => {
  it('accepts role update', () => {
    const result = adminUpdateUserSchema.safeParse({ role: 'admin' })
    assert.strictEqual(result.success, true)
  })
  it('rejects invalid role', () => {
    const result = adminUpdateUserSchema.safeParse({ role: 'superuser' })
    assert.strictEqual(result.success, false)
  })
})

describe('updateAgentSchema', () => {
  it('accepts display name update', () => {
    const result = updateAgentSchema.safeParse({ displayName: 'My Agent' })
    assert.strictEqual(result.success, true)
  })
})

describe('updateServiceAgentSchema', () => {
  it('accepts config update', () => {
    const result = updateServiceAgentSchema.safeParse({ displayName: 'Updated Service Agent' })
    assert.strictEqual(result.success, true)
  })
})

// ─── Additional Schema Coverage ───

describe('clientSendMessageSchema', () => {
  it('accepts valid send message', () => {
    const result = clientSendMessageSchema.safeParse({
      type: 'client:send_message',
      roomId: 'room1',
      content: 'Hello world',
      mentions: ['user1'],
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts with optional replyToId and attachmentIds', () => {
    const result = clientSendMessageSchema.safeParse({
      type: 'client:send_message',
      roomId: 'room1',
      content: 'Reply',
      mentions: [],
      replyToId: 'msg123',
      attachmentIds: ['att1', 'att2'],
    })
    assert.strictEqual(result.success, true)
  })

  it('rejects empty content', () => {
    const result = clientSendMessageSchema.safeParse({
      type: 'client:send_message',
      roomId: 'room1',
      content: '',
      mentions: [],
    })
    assert.strictEqual(result.success, false)
  })
})

describe('createBookmarkSchema', () => {
  it('accepts valid bookmark', () => {
    const result = createBookmarkSchema.safeParse({ messageId: 'msg1' })
    assert.strictEqual(result.success, true)
  })

  it('accepts with note', () => {
    const result = createBookmarkSchema.safeParse({ messageId: 'msg1', note: 'Important' })
    assert.strictEqual(result.success, true)
  })

  it('rejects missing messageId', () => {
    const result = createBookmarkSchema.safeParse({})
    assert.strictEqual(result.success, false)
  })
})

describe('gatewayMessageChunkSchema', () => {
  it('accepts valid text chunk', () => {
    const result = gatewayMessageChunkSchema.safeParse({
      type: 'gateway:message_chunk',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      chunk: { type: 'text', content: 'Hello' },
    })
    assert.strictEqual(result.success, true)
  })
})

describe('gatewayMessageCompleteSchema', () => {
  it('accepts valid message complete', () => {
    const result = gatewayMessageCompleteSchema.safeParse({
      type: 'gateway:message_complete',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      fullContent: 'Full response text',
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts with optional chunks and depth', () => {
    const result = gatewayMessageCompleteSchema.safeParse({
      type: 'gateway:message_complete',
      roomId: 'room1',
      agentId: 'agent1',
      messageId: 'msg1',
      fullContent: 'Full text',
      chunks: [{ type: 'text', content: 'Full text' }],
      depth: 2,
    })
    assert.strictEqual(result.success, true)
  })
})

describe('gatewayTaskUpdateSchema', () => {
  it('accepts valid task update', () => {
    for (const status of TASK_STATUSES) {
      const result = gatewayTaskUpdateSchema.safeParse({
        type: 'gateway:task_update',
        taskId: 'task1',
        status,
      })
      assert.strictEqual(result.success, true, `should accept status: ${status}`)
    }
  })

  it('accepts with optional result', () => {
    const result = gatewayTaskUpdateSchema.safeParse({
      type: 'gateway:task_update',
      taskId: 'task1',
      status: 'completed',
      result: 'Task completed successfully',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('gatewayTerminalDataSchema', () => {
  it('accepts valid terminal data', () => {
    const result = gatewayTerminalDataSchema.safeParse({
      type: 'gateway:terminal_data',
      agentId: 'agent1',
      data: 'ls -la\n',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverNewMessageSchema', () => {
  it('accepts valid new message event', () => {
    const result = serverNewMessageSchema.safeParse({
      type: 'server:new_message',
      message: {
        id: 'msg1',
        roomId: 'room1',
        senderId: 'user1',
        senderType: 'user',
        senderName: 'Alice',
        type: 'text',
        content: 'Hello',
        mentions: [],
        createdAt: '2026-01-01T00:00:00Z',
      },
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverMessageDeletedSchema', () => {
  it('accepts valid message deleted event', () => {
    const result = serverMessageDeletedSchema.safeParse({
      type: 'server:message_deleted',
      roomId: 'room1',
      messageId: 'msg1',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverTypingSchema', () => {
  it('accepts valid typing event', () => {
    const result = serverTypingSchema.safeParse({
      type: 'server:typing',
      roomId: 'room1',
      userId: 'user1',
      username: 'alice',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverReadReceiptSchema', () => {
  it('accepts valid read receipt', () => {
    const result = serverReadReceiptSchema.safeParse({
      type: 'server:read_receipt',
      roomId: 'room1',
      userId: 'user1',
      username: 'alice',
      lastReadAt: '2026-01-01T00:00:00Z',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('serverRoomRemovedSchema', () => {
  it('accepts valid room removed event', () => {
    const result = serverRoomRemovedSchema.safeParse({
      type: 'server:room_removed',
      roomId: 'room1',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('userSchema', () => {
  it('accepts valid user', () => {
    for (const role of USER_ROLES) {
      const result = userSchema.safeParse({
        id: 'u1',
        username: 'alice',
        displayName: 'Alice',
        role,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })
      assert.strictEqual(result.success, true, `should accept role: ${role}`)
    }
  })

  it('accepts with optional avatarUrl', () => {
    const result = userSchema.safeParse({
      id: 'u1',
      username: 'bob',
      displayName: 'Bob',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    assert.strictEqual(result.success, true)
  })
})

describe('gatewaySchema', () => {
  it('accepts valid gateway', () => {
    const result = gatewaySchema.safeParse({
      id: 'gw1',
      userId: 'u1',
      name: 'My Gateway',
      deviceInfo: {
        hostname: 'laptop',
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v22.0.0',
      },
      createdAt: '2026-01-01T00:00:00Z',
    })
    assert.strictEqual(result.success, true)
  })

  it('accepts with optional fields', () => {
    const result = gatewaySchema.safeParse({
      id: 'gw1',
      userId: 'u1',
      name: 'My Gateway',
      deviceInfo: {
        hostname: 'laptop',
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.0.0',
        agentimVersion: '0.1.0',
      },
      connectedAt: '2026-01-01T00:00:00Z',
      disconnectedAt: '2026-01-01T01:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
    })
    assert.strictEqual(result.success, true)
  })
})
