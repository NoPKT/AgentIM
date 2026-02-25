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
} from '../src/index.js'
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, I18N_NAMESPACES, en, zhCN, ja, ko, fr, de, ru } from '../src/i18n/index.js'

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

  it('SUPPORTED_LANGUAGES includes 7 languages', () => {
    assert.equal(SUPPORTED_LANGUAGES.length, 7)
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
