import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getProvider,
  listProviders,
  getProvidersByCategory,
} from '../../src/lib/providers/registry.js'

describe('Provider Registry', () => {
  it('registers all built-in providers', () => {
    const providers = listProviders()
    assert.ok(providers.length >= 7, `Expected at least 7 providers, got ${providers.length}`)

    const types = providers.map((p) => p.type)
    assert.ok(types.includes('openai-chat'))
    assert.ok(types.includes('perplexity'))
    assert.ok(types.includes('openai-image'))
    assert.ok(types.includes('elevenlabs'))
    assert.ok(types.includes('runway'))
    assert.ok(types.includes('stability-audio'))
    assert.ok(types.includes('meshy'))
  })

  it('getProvider returns correct provider by type', () => {
    const provider = getProvider('openai-chat')
    assert.ok(provider)
    assert.equal(provider.meta.type, 'openai-chat')
    assert.equal(provider.meta.category, 'chat')
    assert.equal(provider.meta.displayName, 'OpenAI Chat')
  })

  it('getProvider returns undefined for unknown type', () => {
    const provider = getProvider('nonexistent-provider')
    assert.equal(provider, undefined)
  })

  it('getProvidersByCategory returns correct providers', () => {
    const chatProviders = getProvidersByCategory('chat')
    assert.ok(chatProviders.length >= 1)
    assert.ok(chatProviders.every((p) => p.category === 'chat'))

    const videoProviders = getProvidersByCategory('video')
    assert.ok(videoProviders.length >= 1)
    assert.ok(videoProviders.every((p) => p.category === 'video'))
  })

  it('each provider has a valid configSchema', () => {
    const providers = listProviders()
    for (const meta of providers) {
      assert.ok(meta.configSchema, `${meta.type} missing configSchema`)
      // Verify it's a Zod schema with parse method
      assert.equal(
        typeof (meta.configSchema as { parse?: unknown }).parse,
        'function',
        `${meta.type} configSchema.parse is not a function`,
      )
    }
  })

  it('each provider meta has required fields', () => {
    const providers = listProviders()
    for (const meta of providers) {
      assert.ok(meta.type, `Provider missing type`)
      assert.ok(meta.displayName, `${meta.type} missing displayName`)
      assert.ok(meta.category, `${meta.type} missing category`)
    }
  })

  it('provider categories cover expected values', () => {
    const providers = listProviders()
    const categories = new Set(providers.map((p) => p.category))
    assert.ok(categories.has('chat'))
    assert.ok(categories.has('search'))
    assert.ok(categories.has('image'))
    assert.ok(categories.has('audio'))
    assert.ok(categories.has('video'))
    assert.ok(categories.has('music'))
    assert.ok(categories.has('3d'))
  })
})
