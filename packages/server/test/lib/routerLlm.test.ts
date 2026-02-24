import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractJsonObject, tokenize, scoreAgent } from '../../src/lib/routerLlm.js'

// ─── extractJsonObject ──────────────────────────────────────────────────────

describe('extractJsonObject', () => {
  it('extracts a simple JSON object', () => {
    const input = '{"agentIds":["a","b"]}'
    assert.equal(extractJsonObject(input), input)
  })

  it('extracts JSON surrounded by prose', () => {
    const input = 'Here is the result: {"agentIds":["x"]} Done.'
    assert.equal(extractJsonObject(input), '{"agentIds":["x"]}')
  })

  it('extracts JSON from markdown code block', () => {
    const input = 'Result:\n```json\n{"agentIds":["x"]}\n```\nEnd.'
    assert.equal(extractJsonObject(input), '{"agentIds":["x"]}')
  })

  it('handles nested JSON objects', () => {
    const input = '{"outer":{"inner":"value"}}'
    assert.equal(extractJsonObject(input), input)
  })

  it('handles deeply nested objects', () => {
    const input = '{"a":{"b":{"c":{"d":"val"}}}}'
    assert.equal(extractJsonObject(input), input)
  })

  it('handles escaped double quotes in strings', () => {
    const input = '{"msg":"He said \\"hello\\""}'
    assert.equal(extractJsonObject(input), input)
  })

  it('handles backslash escapes inside strings', () => {
    const input = '{"path":"C:\\\\Users\\\\test"}'
    assert.equal(extractJsonObject(input), input)
  })

  it('handles braces inside JSON strings', () => {
    const input = '{"code":"function() { return {} }"}'
    assert.equal(extractJsonObject(input), input)
  })

  it('returns null when no JSON object found', () => {
    assert.equal(extractJsonObject('no json here'), null)
  })

  it('returns null for empty string', () => {
    assert.equal(extractJsonObject(''), null)
  })

  it('returns null for unclosed brace', () => {
    assert.equal(extractJsonObject('{"key": "value"'), null)
  })

  it('extracts only the first JSON object when multiple exist', () => {
    const input = '{"first":"1"} some text {"second":"2"}'
    const result = extractJsonObject(input)
    assert.equal(result, '{"first":"1"}')
  })

  it('handles multiline JSON', () => {
    const input = '{\n  "agentIds": [\n    "agent-1",\n    "agent-2"\n  ]\n}'
    assert.equal(extractJsonObject(input), input)
  })

  it('handles special characters in strings (newlines, tabs)', () => {
    const input = '{"text":"line1\\nline2\\ttab"}'
    assert.equal(extractJsonObject(input), input)
  })

  it('extracted JSON is valid and parseable', () => {
    const input = 'Response: {"agentIds":["id1","id2"],"reason":"both relevant"} end'
    const result = extractJsonObject(input)
    assert.ok(result)
    const parsed = JSON.parse(result)
    assert.deepEqual(parsed.agentIds, ['id1', 'id2'])
  })
})

// ─── tokenize ───────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('extracts English tokens in lowercase', () => {
    const result = tokenize('Hello World Test')
    assert.deepEqual(result, new Set(['hello', 'world', 'test']))
  })

  it('extracts Chinese characters', () => {
    const result = tokenize('代码审查')
    assert.ok(result.size > 0)
    // Each Chinese char is a token
    for (const token of result) {
      assert.ok(/[\u4e00-\u9fff]+/.test(token))
    }
  })

  it('extracts mixed English and Chinese', () => {
    const result = tokenize('Hello 你好 world')
    assert.ok(result.has('hello'))
    assert.ok(result.has('world'))
    // Chinese chars present
    assert.ok(result.size >= 3)
  })

  it('deduplicates repeated tokens', () => {
    const result = tokenize('test test test')
    assert.equal(result.size, 1)
    assert.ok(result.has('test'))
  })

  it('returns empty set for empty string', () => {
    assert.equal(tokenize('').size, 0)
  })

  it('returns empty set for only punctuation/symbols', () => {
    assert.equal(tokenize('!@#$%^&*()').size, 0)
  })

  it('extracts numbers', () => {
    const result = tokenize('version 3 test')
    assert.ok(result.has('3'))
    assert.ok(result.has('version'))
    assert.ok(result.has('test'))
  })

  it('converts to lowercase', () => {
    const result = tokenize('Claude CODE Debug')
    assert.ok(result.has('claude'))
    assert.ok(result.has('code'))
    assert.ok(result.has('debug'))
    assert.ok(!result.has('Claude'))
  })
})

// ─── scoreAgent ─────────────────────────────────────────────────────────────

describe('scoreAgent', () => {
  it('returns positive score for matching tokens', () => {
    const tokens = tokenize('fix the code bug')
    const score = scoreAgent(tokens, {
      name: 'CodeBot',
      type: 'claude-code',
      capabilities: ['code', 'debug'],
    })
    assert.ok(score > 0)
  })

  it('returns 0 for no matching tokens', () => {
    const tokens = tokenize('translate this document')
    const score = scoreAgent(tokens, {
      name: 'DataBot',
      type: 'generic',
      capabilities: ['analytics', 'visualization'],
    })
    assert.equal(score, 0)
  })

  it('scores higher for more matching tokens', () => {
    const tokens = tokenize('code review and debug')
    const highMatch = scoreAgent(tokens, {
      name: 'CodeDebugger',
      type: 'claude-code',
      capabilities: ['code', 'review', 'debug'],
    })
    const lowMatch = scoreAgent(tokens, {
      name: 'Writer',
      type: 'generic',
      capabilities: ['writing'],
    })
    assert.ok(highMatch > lowMatch)
  })

  it('matches against agent name', () => {
    const tokens = tokenize('claude help me')
    const score = scoreAgent(tokens, {
      name: 'Claude',
      type: 'generic',
    })
    assert.ok(score > 0)
  })

  it('matches against agent type', () => {
    const tokens = tokenize('use generic agent')
    const score = scoreAgent(tokens, {
      name: 'Bot',
      type: 'generic',
    })
    assert.ok(score > 0)
  })

  it('handles agent with no capabilities', () => {
    const tokens = tokenize('test message')
    const score = scoreAgent(tokens, {
      name: 'TestBot',
      type: 'test',
    })
    assert.equal(typeof score, 'number')
  })

  it('handles empty capabilities array', () => {
    const tokens = tokenize('test')
    const score = scoreAgent(tokens, {
      name: 'Bot',
      type: 'generic',
      capabilities: [],
    })
    assert.equal(typeof score, 'number')
  })
})
