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
  clientMessageSchema,
  gatewayMessageSchema,
  AGENT_TYPES,
  AGENT_STATUSES,
  ROOM_TYPES,
  ROUTING_MODES,
  AGENT_CONNECTION_TYPES,
  MAX_MESSAGE_LENGTH,
} from '../src/index.js'
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, en, zhCN, ja, ko, fr, de, ru } from '../src/i18n/index.js'

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
