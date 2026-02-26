import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, registerUser } from './helpers.js'

describe('Service Agents API', () => {
  let adminToken: string
  let userToken: string

  before(async () => {
    await startServer()

    // Login as admin
    const loginRes = await api('POST', '/api/auth/login', {
      username: 'admin',
      password: 'AdminPass123',
    })
    assert.equal(loginRes.data.ok, true, 'Admin login should succeed')
    adminToken = loginRes.data.data.accessToken

    // Register a non-admin user
    const user = await registerUser('sa_testuser')
    userToken = user.accessToken
  })

  after(async () => {
    await stopServer()
  })

  // ─── Access Control ───

  describe('Access Control', () => {
    it('rejects unauthenticated request to list service agents', async () => {
      const res = await api('GET', '/api/service-agents')
      assert.equal(res.status, 401)
    })

    it('rejects unauthenticated request to list providers', async () => {
      const res = await api('GET', '/api/service-agents/providers')
      assert.equal(res.status, 401)
    })

    it('rejects non-admin user from listing service agents', async () => {
      const res = await api('GET', '/api/service-agents', undefined, userToken)
      assert.equal(res.status, 403)
    })

    it('rejects non-admin user from listing providers', async () => {
      const res = await api('GET', '/api/service-agents/providers', undefined, userToken)
      assert.equal(res.status, 403)
    })

    it('rejects non-admin user from creating a service agent', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Forbidden Agent',
          type: 'custom',
          config: { apiKey: 'sk-test123456' },
        },
        userToken,
      )
      assert.equal(res.status, 403)
    })

    it('rejects non-admin user from deleting a service agent', async () => {
      const res = await api('DELETE', '/api/service-agents/nonexistent', undefined, userToken)
      assert.equal(res.status, 403)
    })

    it('rejects non-admin user from validating a service agent', async () => {
      const res = await api('POST', '/api/service-agents/nonexistent/validate', undefined, userToken)
      assert.equal(res.status, 403)
    })
  })

  // ─── Providers ───

  describe('GET /api/service-agents/providers', () => {
    it('returns list of providers with expected fields', async () => {
      const res = await api('GET', '/api/service-agents/providers', undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
      assert.ok(res.data.data.length >= 1, 'Should have at least one provider')

      // Verify each provider has the expected fields
      for (const provider of res.data.data) {
        assert.ok(provider.type, 'Provider should have a type')
        assert.ok(provider.displayName, 'Provider should have a displayName')
        assert.ok(provider.category, 'Provider should have a category')
        assert.ok(provider.configSchema, 'Provider should have a configSchema')
      }
    })

    it('includes openai-chat provider', async () => {
      const res = await api('GET', '/api/service-agents/providers', undefined, adminToken)
      const openai = res.data.data.find((p: any) => p.type === 'openai-chat')
      assert.ok(openai, 'Should include openai-chat provider')
      assert.equal(openai.category, 'chat')
      assert.equal(openai.displayName, 'OpenAI Chat')
    })

    it('includes perplexity provider', async () => {
      const res = await api('GET', '/api/service-agents/providers', undefined, adminToken)
      const perplexity = res.data.data.find((p: any) => p.type === 'perplexity')
      assert.ok(perplexity, 'Should include perplexity provider')
      assert.equal(perplexity.category, 'search')
    })
  })

  // ─── CRUD Lifecycle ───

  describe('CRUD Lifecycle', () => {
    let agentId: string

    it('creates a service agent with custom type', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'My Custom Agent',
          type: 'custom',
          config: { endpoint: 'https://example.com/api', apiKey: 'sk-test123456' },
          description: 'A test custom agent',
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.id)
      assert.equal(res.data.data.name, 'My Custom Agent')
      assert.equal(res.data.data.type, 'custom')
      assert.equal(res.data.data.status, 'active')
      assert.equal(res.data.data.description, 'A test custom agent')
      // configEncrypted should NOT be in the response
      assert.equal(res.data.data.configEncrypted, undefined)
      agentId = res.data.data.id
    })

    it('lists service agents without config', async () => {
      const res = await api('GET', '/api/service-agents', undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
      assert.ok(res.data.data.length >= 1)

      // Find our agent
      const agent = res.data.data.find((a: any) => a.id === agentId)
      assert.ok(agent, 'Created agent should appear in list')
      assert.equal(agent.name, 'My Custom Agent')
      // configEncrypted should be stripped from list
      assert.equal(agent.configEncrypted, undefined)
      // config should NOT be present in list either
      assert.equal(agent.config, undefined)
    })

    it('gets a single service agent with masked config', async () => {
      const res = await api('GET', `/api/service-agents/${agentId}`, undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.id, agentId)
      assert.equal(res.data.data.name, 'My Custom Agent')
      // config should be present and decrypted
      assert.ok(res.data.data.config, 'Config should be present in GET by ID')
      // apiKey should be masked: first 4 chars + bullet chars
      assert.ok(
        res.data.data.config.apiKey.startsWith('sk-t'),
        'Masked API key should start with first 4 chars',
      )
      assert.ok(
        res.data.data.config.apiKey.includes('••••••••'),
        'Masked API key should contain bullet mask',
      )
      assert.equal(res.data.data.config.endpoint, 'https://example.com/api')
      // configEncrypted should NOT be in response
      assert.equal(res.data.data.configEncrypted, undefined)
    })

    it('updates a service agent name', async () => {
      const res = await api(
        'PUT',
        `/api/service-agents/${agentId}`,
        { name: 'Renamed Agent' },
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'Renamed Agent')
    })

    it('updates a service agent status', async () => {
      const res = await api(
        'PUT',
        `/api/service-agents/${agentId}`,
        { status: 'inactive' },
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.status, 'inactive')
    })

    it('updates a service agent description', async () => {
      const res = await api(
        'PUT',
        `/api/service-agents/${agentId}`,
        { description: 'Updated description' },
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.description, 'Updated description')
    })

    it('deletes a service agent', async () => {
      const res = await api('DELETE', `/api/service-agents/${agentId}`, undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)

      // Verify it is gone
      const getRes = await api('GET', `/api/service-agents/${agentId}`, undefined, adminToken)
      assert.equal(getRes.status, 404)
    })
  })

  // ─── Config Merge on Update ───

  describe('Config Merge on Update', () => {
    let agentId: string

    before(async () => {
      // Create a custom agent with initial config
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Merge Test Agent',
          type: 'custom',
          config: { apiKey: 'sk-original123', endpoint: 'https://old.api.com', setting1: 'value1' },
        },
        adminToken,
      )
      agentId = res.data.data.id
    })

    it('merges config with existing on update (preserves untouched keys)', async () => {
      // Update only the endpoint, keeping apiKey and setting1
      const res = await api(
        'PUT',
        `/api/service-agents/${agentId}`,
        { config: { endpoint: 'https://new.api.com', setting2: 'value2' } },
        adminToken,
      )
      assert.equal(res.status, 200)

      // Verify merged config via GET
      const getRes = await api('GET', `/api/service-agents/${agentId}`, undefined, adminToken)
      assert.equal(getRes.status, 200)
      const config = getRes.data.data.config
      // apiKey is masked but should still be present
      assert.ok(config.apiKey, 'Original apiKey should be preserved')
      assert.equal(config.endpoint, 'https://new.api.com')
      assert.equal(config.setting1, 'value1')
      assert.equal(config.setting2, 'value2')
    })

    after(async () => {
      await api('DELETE', `/api/service-agents/${agentId}`, undefined, adminToken)
    })
  })

  // ─── Validation Errors ───

  describe('Validation Errors', () => {
    it('rejects creation without name', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          type: 'custom',
          config: { apiKey: 'sk-test123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with empty name', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: '',
          type: 'custom',
          config: { apiKey: 'sk-test123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with whitespace-only name', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: '   ',
          type: 'custom',
          config: { apiKey: 'sk-test123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation without config', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'No Config Agent',
          type: 'custom',
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with invalid type', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Invalid Type Agent',
          type: 'nonexistent_type',
          config: { apiKey: 'sk-test123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects openai-chat creation without apiKey in config', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Missing API Key',
          type: 'openai-chat',
          config: { model: 'gpt-4o' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects openai-chat creation without model in config', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Missing Model',
          type: 'openai-chat',
          config: { apiKey: 'sk-test123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects openai-chat creation with invalid provider config (missing baseUrl)', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Invalid Provider Config',
          type: 'openai-chat',
          config: { apiKey: 'sk-test123456', model: 'gpt-4o' },
        },
        adminToken,
      )
      // Provider-level validation should fail because baseUrl is required
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.ok(res.data.error, 'Should have an error message')
    })

    it('rejects elevenlabs creation without voiceId in config', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Missing VoiceId',
          type: 'elevenlabs',
          config: { apiKey: 'sk-test123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })
  })

  // ─── 404 for Non-Existent Agents ───

  describe('Non-existent Agent Operations', () => {
    it('returns 404 when getting a non-existent agent', async () => {
      const res = await api(
        'GET',
        '/api/service-agents/nonexistent-id-12345',
        undefined,
        adminToken,
      )
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
      assert.ok(res.data.error.includes('not found'))
    })

    it('returns 404 when updating a non-existent agent', async () => {
      const res = await api(
        'PUT',
        '/api/service-agents/nonexistent-id-12345',
        { name: 'Ghost' },
        adminToken,
      )
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
    })

    it('returns 404 when deleting a non-existent agent', async () => {
      const res = await api(
        'DELETE',
        '/api/service-agents/nonexistent-id-12345',
        undefined,
        adminToken,
      )
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
    })

    it('returns 404 when validating a non-existent agent', async () => {
      const res = await api(
        'POST',
        '/api/service-agents/nonexistent-id-12345/validate',
        undefined,
        adminToken,
      )
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
    })
  })

  // ─── Validate Endpoint ───

  describe('POST /api/service-agents/:id/validate', () => {
    let customAgentId: string

    before(async () => {
      // Create a custom agent (no validateConfig implementation)
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Validate Test Custom',
          type: 'custom',
          config: { apiKey: 'sk-validate-test', endpoint: 'https://example.com' },
        },
        adminToken,
      )
      customAgentId = res.data.data.id
    })

    it('returns valid with no-validation-available message for unregistered provider type', async () => {
      const res = await api(
        'POST',
        `/api/service-agents/${customAgentId}/validate`,
        undefined,
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.valid, true)
      assert.ok(res.data.data.message, 'Should include a message')
    })

    after(async () => {
      await api('DELETE', `/api/service-agents/${customAgentId}`, undefined, adminToken)
    })
  })

  // ─── Provider-Specific Creation ───

  describe('Provider-Specific Creation', () => {
    it('creates an openai-chat agent with valid config', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'OpenAI Chat Agent',
          type: 'openai-chat',
          config: {
            apiKey: 'sk-test123456',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
          },
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'OpenAI Chat Agent')
      assert.equal(res.data.data.type, 'openai-chat')
      assert.equal(res.data.data.category, 'chat')
      assert.equal(res.data.data.status, 'active')

      // Clean up
      await api('DELETE', `/api/service-agents/${res.data.data.id}`, undefined, adminToken)
    })

    it('creates a custom agent without apiKey requirement', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Custom No API Key',
          type: 'custom',
          config: { endpoint: 'https://my-service.local/api' },
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.type, 'custom')

      // Clean up
      await api('DELETE', `/api/service-agents/${res.data.data.id}`, undefined, adminToken)
    })

    it('derives category from provider when not explicitly set', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Auto Category Agent',
          type: 'openai-chat',
          config: {
            apiKey: 'sk-test123456',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
          },
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      // openai-chat provider has category 'chat'
      assert.equal(res.data.data.category, 'chat')

      // Clean up
      await api('DELETE', `/api/service-agents/${res.data.data.id}`, undefined, adminToken)
    })

    it('allows explicit category override', async () => {
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Explicit Category Agent',
          type: 'custom',
          config: { apiKey: 'sk-test123456' },
          category: 'image',
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.data.category, 'image')

      // Clean up
      await api('DELETE', `/api/service-agents/${res.data.data.id}`, undefined, adminToken)
    })
  })

  // ─── Edge Cases ───

  describe('Edge Cases', () => {
    it('handles update with empty body gracefully', async () => {
      // Create an agent first
      const createRes = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Edge Case Agent',
          type: 'custom',
          config: { apiKey: 'sk-edge123456' },
        },
        adminToken,
      )
      const agentId = createRes.data.data.id

      // Update with empty object (no fields to change)
      const res = await api('PUT', `/api/service-agents/${agentId}`, {}, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'Edge Case Agent')

      // Clean up
      await api('DELETE', `/api/service-agents/${agentId}`, undefined, adminToken)
    })

    it('name with max length (100 chars) succeeds', async () => {
      const longName = 'A'.repeat(100)
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: longName,
          type: 'custom',
          config: { apiKey: 'sk-long123456' },
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.data.name, longName)

      // Clean up
      await api('DELETE', `/api/service-agents/${res.data.data.id}`, undefined, adminToken)
    })

    it('name exceeding max length (101 chars) fails', async () => {
      const tooLong = 'A'.repeat(101)
      const res = await api(
        'POST',
        '/api/service-agents',
        {
          name: tooLong,
          type: 'custom',
          config: { apiKey: 'sk-toolong123' },
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('creating multiple agents and listing returns all', async () => {
      // Create two agents
      const res1 = await api(
        'POST',
        '/api/service-agents',
        { name: 'Multi Agent 1', type: 'custom', config: { apiKey: 'sk-multi1' } },
        adminToken,
      )
      const res2 = await api(
        'POST',
        '/api/service-agents',
        { name: 'Multi Agent 2', type: 'custom', config: { apiKey: 'sk-multi2' } },
        adminToken,
      )
      const id1 = res1.data.data.id
      const id2 = res2.data.data.id

      // List should include both
      const listRes = await api('GET', '/api/service-agents', undefined, adminToken)
      const ids = listRes.data.data.map((a: any) => a.id)
      assert.ok(ids.includes(id1), 'List should include first agent')
      assert.ok(ids.includes(id2), 'List should include second agent')

      // Clean up
      await api('DELETE', `/api/service-agents/${id1}`, undefined, adminToken)
      await api('DELETE', `/api/service-agents/${id2}`, undefined, adminToken)
    })

    it('update with config triggers re-validation against provider schema', async () => {
      // Create a valid openai-chat agent
      const createRes = await api(
        'POST',
        '/api/service-agents',
        {
          name: 'Revalidation Agent',
          type: 'openai-chat',
          config: {
            apiKey: 'sk-reval123456',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
          },
        },
        adminToken,
      )
      const agentId = createRes.data.data.id

      // Update baseUrl to an invalid value (not a URL) — merged config should fail provider validation
      const updateRes = await api(
        'PUT',
        `/api/service-agents/${agentId}`,
        { config: { baseUrl: 'not-a-url' } },
        adminToken,
      )
      assert.equal(updateRes.status, 400)
      assert.equal(updateRes.data.ok, false)

      // Clean up
      await api('DELETE', `/api/service-agents/${agentId}`, undefined, adminToken)
    })
  })
})
