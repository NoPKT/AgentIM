import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { openaiChatProvider } from '../../src/lib/providers/openai-chat.js'

describe('OpenAI Chat Provider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('has correct meta', () => {
    assert.equal(openaiChatProvider.meta.type, 'openai-chat')
    assert.equal(openaiChatProvider.meta.category, 'chat')
  })

  it('validates config schema - valid', () => {
    const result = openaiChatProvider.meta.configSchema.safeParse({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    })
    assert.ok(result.success)
  })

  it('validates config schema - missing apiKey', () => {
    const result = openaiChatProvider.meta.configSchema.safeParse({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    })
    assert.ok(!result.success)
  })

  it('invokes and returns text result', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from GPT' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const result = await openaiChatProvider.invoke(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      },
      { prompt: 'Hello', senderName: 'User' },
    )

    assert.equal(result.kind, 'text')
    if (result.kind === 'text') {
      assert.equal(result.content, 'Hello from GPT')
      assert.deepEqual(result.tokensUsed, { input: 10, output: 5 })
    }
  })

  it('throws on API error', async () => {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 })

    await assert.rejects(
      () =>
        openaiChatProvider.invoke(
          {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'bad-key',
            model: 'gpt-4o',
          },
          { prompt: 'Hello', senderName: 'User' },
        ),
      { message: /OpenAI API error \(401\)/ },
    )
  })

  it('includes system prompt when configured', async () => {
    let capturedBody: string | undefined
    globalThis.fetch = async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await openaiChatProvider.invoke(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o',
        systemPrompt: 'You are helpful',
      },
      { prompt: 'Hi', senderName: 'User' },
    )

    assert.ok(capturedBody)
    const body = JSON.parse(capturedBody!)
    assert.equal(body.messages[0].role, 'system')
    assert.equal(body.messages[0].content, 'You are helpful')
  })
})
