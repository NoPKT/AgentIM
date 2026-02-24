import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { perplexityProvider } from '../../src/lib/providers/perplexity.js'

describe('Perplexity Provider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('has correct meta', () => {
    assert.equal(perplexityProvider.meta.type, 'perplexity')
    assert.equal(perplexityProvider.meta.category, 'search')
  })

  it('validates config schema', () => {
    const valid = perplexityProvider.meta.configSchema.safeParse({ apiKey: 'pplx-test' })
    assert.ok(valid.success)

    const invalid = perplexityProvider.meta.configSchema.safeParse({})
    assert.ok(!invalid.success)
  })

  it('invokes and returns text with citations', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Search result' } }],
          citations: ['https://example.com/1', 'https://example.com/2'],
          usage: { prompt_tokens: 15, completion_tokens: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const result = await perplexityProvider.invoke(
      { apiKey: 'pplx-test' },
      { prompt: 'What is AI?', senderName: 'User' },
    )

    assert.equal(result.kind, 'text')
    if (result.kind === 'text') {
      assert.equal(result.content, 'Search result')
      assert.deepEqual(result.citations, ['https://example.com/1', 'https://example.com/2'])
    }
  })
})
