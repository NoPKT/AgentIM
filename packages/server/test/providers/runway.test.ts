import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { runwayProvider } from '../../src/lib/providers/runway.js'

describe('Runway Provider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('has correct meta', () => {
    assert.equal(runwayProvider.meta.type, 'runway')
    assert.equal(runwayProvider.meta.category, 'video')
  })

  it('validates config schema', () => {
    const valid = runwayProvider.meta.configSchema.safeParse({ apiKey: 'rw-test' })
    assert.ok(valid.success)
  })

  it('invoke returns async task result', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ id: 'task-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const result = await runwayProvider.invoke(
      { apiKey: 'rw-test' },
      { prompt: 'A sunset timelapse', senderName: 'User' },
    )

    assert.equal(result.kind, 'async')
    if (result.kind === 'async') {
      assert.equal(result.taskId, 'task-123')
      assert.ok(result.pollIntervalMs > 0)
      assert.ok(result.maxWaitMs > 0)
    }
  })

  it('poll returns media result on success', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'SUCCEEDED',
          output: ['https://cdn.runway.com/video.mp4'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const result = await runwayProvider.poll!({ apiKey: 'rw-test' }, 'task-123')

    assert.equal(result.kind, 'media')
    if (result.kind === 'media') {
      assert.equal(result.mediaType, 'video')
      assert.equal(result.mimeType, 'video/mp4')
    }
  })

  it('poll returns async result when still processing', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: 'RUNNING' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const result = await runwayProvider.poll!({ apiKey: 'rw-test' }, 'task-123')

    assert.equal(result.kind, 'async')
  })

  it('poll throws on failure', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: 'FAILED', failure: 'Content policy violation' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    await assert.rejects(() => runwayProvider.poll!({ apiKey: 'rw-test' }, 'task-123'), {
      message: /Content policy violation/,
    })
  })
})
