import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { meshyProvider } from '../../src/lib/providers/meshy.js'

describe('Meshy Provider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('has correct meta', () => {
    assert.equal(meshyProvider.meta.type, 'meshy')
    assert.equal(meshyProvider.meta.category, '3d')
  })

  it('validates config schema', () => {
    const valid = meshyProvider.meta.configSchema.safeParse({ apiKey: 'meshy-test' })
    assert.ok(valid.success)
  })

  it('invoke returns async task result', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ result: 'task-456' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const result = await meshyProvider.invoke(
      { apiKey: 'meshy-test' },
      { prompt: 'A low-poly tree', senderName: 'User' },
    )

    assert.equal(result.kind, 'async')
    if (result.kind === 'async') {
      assert.equal(result.taskId, 'task-456')
    }
  })

  it('poll returns media result on success', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'SUCCEEDED',
          model_urls: {
            glb: 'https://cdn.meshy.ai/model.glb',
            fbx: 'https://cdn.meshy.ai/model.fbx',
          },
          thumbnail_url: 'https://cdn.meshy.ai/thumb.png',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const result = await meshyProvider.poll!({ apiKey: 'meshy-test' }, 'task-456')

    assert.equal(result.kind, 'media')
    if (result.kind === 'media') {
      assert.equal(result.mediaType, '3d-model')
      assert.equal(result.mimeType, 'model/gltf-binary')
      assert.equal(result.url, 'https://cdn.meshy.ai/model.glb')
    }
  })
})
