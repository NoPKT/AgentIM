import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { openaiImageProvider } from '../../src/lib/providers/openai-image.js'

describe('OpenAI Image Provider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('has correct meta', () => {
    assert.equal(openaiImageProvider.meta.type, 'openai-image')
    assert.equal(openaiImageProvider.meta.category, 'image')
  })

  it('validates config schema', () => {
    const valid = openaiImageProvider.meta.configSchema.safeParse({
      apiKey: 'sk-test',
    })
    assert.ok(valid.success)
  })

  it('invokes and returns media result', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.openai.com/image.png', revised_prompt: 'A cat' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const result = await openaiImageProvider.invoke(
      { apiKey: 'sk-test' },
      { prompt: 'Draw a cat', senderName: 'User' },
    )

    assert.equal(result.kind, 'media')
    if (result.kind === 'media') {
      assert.equal(result.mediaType, 'image')
      assert.equal(result.url, 'https://cdn.openai.com/image.png')
      assert.equal(result.mimeType, 'image/png')
      assert.equal(result.caption, 'A cat')
    }
  })

  it('throws on empty response', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    await assert.rejects(
      () =>
        openaiImageProvider.invoke(
          { apiKey: 'sk-test' },
          { prompt: 'Draw a cat', senderName: 'User' },
        ),
      { message: /no image/ },
    )
  })
})
