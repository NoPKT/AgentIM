import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, registerUser } from './helpers.js'

// Valid external LLM URL for router creation (passes SSRF check)
// Use a literal public IP to bypass DNS resolution in SSRF check during tests.
// DNS of api.openai.com may resolve to private IPs in some CI/Docker environments.
const VALID_LLM_URL = 'https://8.8.8.8/v1'
const VALID_API_KEY = 'sk-test-key-abcdefghij1234567890'
const VALID_MODEL = 'gpt-4o'

/** Helper to create a router via admin and return its id */
async function createRouter(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; data: any }> {
  const res = await api(
    'POST',
    '/api/routers',
    {
      name: `Router-${Date.now()}`,
      llmBaseUrl: VALID_LLM_URL,
      llmApiKey: VALID_API_KEY,
      llmModel: VALID_MODEL,
      ...overrides,
    },
    token,
  )
  return { id: res.data?.data?.id, data: res.data }
}

describe('Router Routes', () => {
  let adminToken: string
  let adminUserId: string
  let userToken: string
  let userId: string
  let user2Token: string
  let user2Id: string

  before(async () => {
    await startServer()

    // Login as admin
    const adminLogin = await api('POST', '/api/auth/login', {
      username: 'admin',
      password: 'AdminPass123',
    })
    assert.equal(adminLogin.data.ok, true)
    adminToken = adminLogin.data.data.accessToken
    adminUserId = adminLogin.data.data.user.id

    // Create regular users
    const user = await registerUser('router_user1')
    userToken = user.accessToken
    userId = user.userId

    const user2 = await registerUser('router_user2')
    user2Token = user2.accessToken
    user2Id = user2.userId
  })

  after(async () => {
    await stopServer()
  })

  // ─── CREATE (POST /api/routers) ───

  describe('POST /api/routers', () => {
    it('creates a personal router with required fields', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'My Personal Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'My Personal Router')
      assert.equal(res.data.data.scope, 'personal')
      assert.equal(res.data.data.llmBaseUrl, VALID_LLM_URL)
      assert.equal(res.data.data.llmModel, VALID_MODEL)
      assert.ok(res.data.data.id)
      assert.ok(res.data.data.createdAt)
      assert.ok(res.data.data.updatedAt)
    })

    it('creates a router with all optional fields', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'Full Router',
          description: 'A detailed description',
          scope: 'personal',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
          maxChainDepth: 10,
          rateLimitWindow: 120,
          rateLimitMax: 50,
        },
        userToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.data.description, 'A detailed description')
      assert.equal(res.data.data.maxChainDepth, 10)
      assert.equal(res.data.data.rateLimitWindow, 120)
      assert.equal(res.data.data.rateLimitMax, 50)
    })

    it('masks API key in response as ••••XX (last 2 chars)', async () => {
      const apiKey = 'sk-my-secret-key-ending-XZ'
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'Masked Key Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: apiKey,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 201)
      // API key should be masked: ••••XZ (last 2 chars of the original key)
      assert.equal(res.data.data.llmApiKey, '••••XZ')
    })

    it('applies default values for optional numeric fields', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'Defaults Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.data.maxChainDepth, 5)
      assert.equal(res.data.data.rateLimitWindow, 60)
      assert.equal(res.data.data.rateLimitMax, 20)
      assert.equal(res.data.data.visibility, 'all')
    })

    it('rejects creation without authentication', async () => {
      const res = await api('POST', '/api/routers', {
        name: 'No Auth Router',
        llmBaseUrl: VALID_LLM_URL,
        llmApiKey: VALID_API_KEY,
        llmModel: VALID_MODEL,
      })
      assert.equal(res.status, 401)
    })

    it('rejects creation with missing required field: name', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with missing required field: llmBaseUrl', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'No URL Router',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with missing required field: llmApiKey', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'No Key Router',
          llmBaseUrl: VALID_LLM_URL,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with missing required field: llmModel', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'No Model Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with empty name (whitespace only)', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: '   ',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('rejects creation with invalid URL format', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'Bad URL Router',
          llmBaseUrl: 'not-a-url',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('non-admin cannot create global scope routers', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'User Global Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
          scope: 'global',
        },
        userToken,
      )
      assert.equal(res.status, 403)
      assert.equal(res.data.ok, false)
      assert.ok(res.data.error.includes('Admin'))
    })

    it('admin can create global scope routers', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'Admin Global Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
          scope: 'global',
        },
        adminToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.data.scope, 'global')
    })
  })

  // ─── SSRF Protection ───

  describe('SSRF Protection', () => {
    it('blocks localhost URL on create', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'SSRF Localhost',
          llmBaseUrl: 'http://localhost:8080/v1',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })

    it('blocks 127.0.0.1 URL on create', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'SSRF 127',
          llmBaseUrl: 'http://127.0.0.1:1234/v1',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })

    it('blocks 10.x.x.x private IP on create', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'SSRF 10',
          llmBaseUrl: 'http://10.0.0.1/v1',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })

    it('blocks 192.168.x.x private IP on create', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'SSRF 192',
          llmBaseUrl: 'http://192.168.1.1/v1',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })

    it('blocks 172.16.x.x private IP on create', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'SSRF 172',
          llmBaseUrl: 'http://172.16.0.1/v1',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })

    it('blocks cloud metadata endpoint (169.254.169.254) on create', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'SSRF Metadata',
          llmBaseUrl: 'http://169.254.169.254/latest/meta-data/',
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
        },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })

    it('blocks SSRF on update (PUT) with internal URL', async () => {
      const { id } = await createRouter(userToken)
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { llmBaseUrl: 'http://127.0.0.1:1234/v1' },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.ok(res.data.error.includes('internal') || res.data.error.includes('private'))
    })
  })

  // ─── LIST (GET /api/routers) ───

  describe('GET /api/routers', () => {
    it('returns empty list when user has no routers', async () => {
      const freshUser = await registerUser('router_fresh')
      const res = await api('GET', '/api/routers', undefined, freshUser.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
    })

    it('user sees own personal routers', async () => {
      const freshUser = await registerUser('router_list1')
      await createRouter(freshUser.accessToken, { name: 'My Router List Test' })

      const res = await api('GET', '/api/routers', undefined, freshUser.accessToken)
      assert.equal(res.status, 200)
      const found = res.data.data.find((r: any) => r.name === 'My Router List Test')
      assert.ok(found, 'User should see their own personal router')
    })

    it('user does not see another user personal routers', async () => {
      const userA = await registerUser('router_list2a')
      const userB = await registerUser('router_list2b')
      await createRouter(userA.accessToken, { name: 'A-Only-Router' })

      const res = await api('GET', '/api/routers', undefined, userB.accessToken)
      assert.equal(res.status, 200)
      const found = res.data.data.find((r: any) => r.name === 'A-Only-Router')
      assert.ok(!found, 'User B should not see User A personal router')
    })

    it('user sees visible global routers (visibility=all)', async () => {
      await createRouter(adminToken, {
        name: 'Global Visible Router',
        scope: 'global',
        visibility: 'all',
      })

      const res = await api('GET', '/api/routers', undefined, userToken)
      assert.equal(res.status, 200)
      const found = res.data.data.find((r: any) => r.name === 'Global Visible Router')
      assert.ok(found, 'User should see global router with visibility=all')
    })

    it('admin sees all routers', async () => {
      const res = await api('GET', '/api/routers', undefined, adminToken)
      assert.equal(res.status, 200)
      assert.ok(res.data.data.length > 0, 'Admin should see all routers')
    })

    it('all routers in list have masked API keys', async () => {
      const res = await api('GET', '/api/routers', undefined, adminToken)
      assert.equal(res.status, 200)
      for (const router of res.data.data) {
        assert.ok(
          router.llmApiKey.startsWith('••••'),
          `API key should be masked: ${router.llmApiKey}`,
        )
      }
    })

    it('rejects list without authentication', async () => {
      const res = await api('GET', '/api/routers')
      assert.equal(res.status, 401)
    })
  })

  // ─── GET BY ID (GET /api/routers/:id) ───

  describe('GET /api/routers/:id', () => {
    it('returns router by id for owner', async () => {
      const { id } = await createRouter(userToken, { name: 'GetById Router' })
      const res = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.id, id)
      assert.equal(res.data.data.name, 'GetById Router')
    })

    it('returns masked API key in single router response', async () => {
      const { id } = await createRouter(userToken, {
        name: 'Single Masked Router',
        llmApiKey: 'sk-secret-key-ending-AB',
      })
      const res = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.llmApiKey, '••••AB')
    })

    it('returns 404 for non-existent router id', async () => {
      const res = await api('GET', '/api/routers/nonexistent12345', undefined, userToken)
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
    })

    it('returns 404 when non-owner tries to access personal router', async () => {
      const { id } = await createRouter(userToken, { name: 'Private Get Router' })
      const res = await api('GET', `/api/routers/${id}`, undefined, user2Token)
      assert.equal(res.status, 404)
    })

    it('admin can access any router by id', async () => {
      const { id } = await createRouter(userToken, { name: 'Admin Access Router' })
      const res = await api('GET', `/api/routers/${id}`, undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.name, 'Admin Access Router')
    })

    it('user can access global router with visibility=all', async () => {
      const { id } = await createRouter(adminToken, {
        name: 'Global Get Router',
        scope: 'global',
        visibility: 'all',
      })
      const res = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.name, 'Global Get Router')
    })
  })

  // ─── UPDATE (PUT /api/routers/:id) ───

  describe('PUT /api/routers/:id', () => {
    it('owner can update router name', async () => {
      const { id } = await createRouter(userToken, { name: 'Before Update' })
      const res = await api('PUT', `/api/routers/${id}`, { name: 'After Update' }, userToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'After Update')
    })

    it('owner can update description', async () => {
      const { id } = await createRouter(userToken, { name: 'Desc Update' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { description: 'Updated description' },
        userToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.description, 'Updated description')
    })

    it('owner can update LLM model', async () => {
      const { id } = await createRouter(userToken, { name: 'Model Update' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { llmModel: 'gpt-3.5-turbo' },
        userToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.llmModel, 'gpt-3.5-turbo')
    })

    it('owner can update LLM base URL with valid external URL', async () => {
      const { id } = await createRouter(userToken, { name: 'URL Update' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { llmBaseUrl: 'https://1.1.1.1/v1' },
        userToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.llmBaseUrl, 'https://1.1.1.1/v1')
    })

    it('owner can update API key (response shows masked new key)', async () => {
      const { id } = await createRouter(userToken, {
        name: 'Key Update',
        llmApiKey: 'sk-old-key-ending-OL',
      })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { llmApiKey: 'sk-new-key-ending-NW' },
        userToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.llmApiKey, '••••NW')
    })

    it('owner can update numeric routing fields', async () => {
      const { id } = await createRouter(userToken, { name: 'Numeric Update' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { maxChainDepth: 15, rateLimitWindow: 300, rateLimitMax: 100 },
        userToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.maxChainDepth, 15)
      assert.equal(res.data.data.rateLimitWindow, 300)
      assert.equal(res.data.data.rateLimitMax, 100)
    })

    it('non-owner cannot update another user router', async () => {
      const { id } = await createRouter(userToken, { name: 'Owned By User1' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { name: 'Hijacked' },
        user2Token,
      )
      assert.equal(res.status, 403)
      assert.equal(res.data.ok, false)
    })

    it('admin can update any router', async () => {
      const { id } = await createRouter(userToken, { name: 'Admin Will Edit' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { name: 'Admin Edited' },
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.name, 'Admin Edited')
    })

    it('returns 404 when updating non-existent router', async () => {
      const res = await api(
        'PUT',
        '/api/routers/nonexistent12345',
        { name: 'Ghost' },
        userToken,
      )
      assert.equal(res.status, 404)
    })

    it('rejects update with invalid data (empty name)', async () => {
      const { id } = await createRouter(userToken, { name: 'Valid Name' })
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { name: '   ' },
        userToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })
  })

  // ─── DELETE (DELETE /api/routers/:id) ───

  describe('DELETE /api/routers/:id', () => {
    it('owner can delete their router', async () => {
      const { id } = await createRouter(userToken, { name: 'Delete Me' })
      const res = await api('DELETE', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)

      // Verify it's gone
      const getRes = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(getRes.status, 404)
    })

    it('admin can delete any router', async () => {
      const { id } = await createRouter(userToken, { name: 'Admin Delete Target' })
      const res = await api('DELETE', `/api/routers/${id}`, undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('non-owner cannot delete another user router', async () => {
      const { id } = await createRouter(userToken, { name: 'Protected Router' })
      const res = await api('DELETE', `/api/routers/${id}`, undefined, user2Token)
      assert.equal(res.status, 403)
      assert.equal(res.data.ok, false)
    })

    it('returns 404 when deleting non-existent router', async () => {
      const res = await api('DELETE', '/api/routers/nonexistent12345', undefined, userToken)
      assert.equal(res.status, 404)
    })

    it('double delete returns 404 on second attempt', async () => {
      const { id } = await createRouter(userToken, { name: 'Double Delete' })
      const first = await api('DELETE', `/api/routers/${id}`, undefined, userToken)
      assert.equal(first.status, 200)

      const second = await api('DELETE', `/api/routers/${id}`, undefined, userToken)
      assert.equal(second.status, 404)
    })
  })

  // ─── Visibility Controls ───

  describe('Visibility Controls', () => {
    it('global router with whitelist: only listed users can see it', async () => {
      const { id } = await createRouter(adminToken, {
        name: 'Whitelisted Router',
        scope: 'global',
        visibility: 'whitelist',
        visibilityList: [userId],
      })

      // User in whitelist can access
      const res1 = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res1.status, 200)

      // User NOT in whitelist cannot access
      const res2 = await api('GET', `/api/routers/${id}`, undefined, user2Token)
      assert.equal(res2.status, 404)
    })

    it('global router with blacklist: listed users cannot see it', async () => {
      const { id } = await createRouter(adminToken, {
        name: 'Blacklisted Router',
        scope: 'global',
        visibility: 'blacklist',
        visibilityList: [userId],
      })

      // User in blacklist cannot access
      const res1 = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res1.status, 404)

      // User NOT in blacklist can access
      const res2 = await api('GET', `/api/routers/${id}`, undefined, user2Token)
      assert.equal(res2.status, 200)
    })

    it('whitelisted users appear in list, non-whitelisted do not', async () => {
      await createRouter(adminToken, {
        name: 'WL List Check Router',
        scope: 'global',
        visibility: 'whitelist',
        visibilityList: [userId],
      })

      // User in whitelist sees it in list
      const res1 = await api('GET', '/api/routers', undefined, userToken)
      const found1 = res1.data.data.find((r: any) => r.name === 'WL List Check Router')
      assert.ok(found1, 'Whitelisted user should see the router in list')

      // User not in whitelist does not see it in list
      const res2 = await api('GET', '/api/routers', undefined, user2Token)
      const found2 = res2.data.data.find((r: any) => r.name === 'WL List Check Router')
      assert.ok(!found2, 'Non-whitelisted user should not see the router in list')
    })

    it('blacklisted users do not appear in list, non-blacklisted do', async () => {
      await createRouter(adminToken, {
        name: 'BL List Check Router',
        scope: 'global',
        visibility: 'blacklist',
        visibilityList: [user2Id],
      })

      // User NOT in blacklist sees it
      const res1 = await api('GET', '/api/routers', undefined, userToken)
      const found1 = res1.data.data.find((r: any) => r.name === 'BL List Check Router')
      assert.ok(found1, 'Non-blacklisted user should see the router in list')

      // User in blacklist does not see it
      const res2 = await api('GET', '/api/routers', undefined, user2Token)
      const found2 = res2.data.data.find((r: any) => r.name === 'BL List Check Router')
      assert.ok(!found2, 'Blacklisted user should not see the router in list')
    })

    it('rejects whitelist/blacklist visibility without visibilityList', async () => {
      const res = await api(
        'POST',
        '/api/routers',
        {
          name: 'No List Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: VALID_API_KEY,
          llmModel: VALID_MODEL,
          scope: 'global',
          visibility: 'whitelist',
          visibilityList: [],
        },
        adminToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
    })

    it('visibility fields are ignored for personal scope routers on update', async () => {
      const { id } = await createRouter(userToken, { name: 'Personal Vis Router' })

      // Try to set visibility on a personal router
      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { visibility: 'whitelist', visibilityList: [user2Id] },
        userToken,
      )
      assert.equal(res.status, 200)
      // Visibility should remain 'all' (default) because scope is personal
      assert.equal(res.data.data.visibility, 'all')
    })

    it('admin can update visibility on global routers', async () => {
      const { id } = await createRouter(adminToken, {
        name: 'Admin Vis Update Router',
        scope: 'global',
        visibility: 'all',
      })

      const res = await api(
        'PUT',
        `/api/routers/${id}`,
        { visibility: 'whitelist', visibilityList: [userId] },
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.data.visibility, 'whitelist')
      assert.deepEqual(res.data.data.visibilityList, [userId])
    })
  })

  // ─── TEST LLM Connection (POST /api/routers/:id/test) ───

  describe('POST /api/routers/:id/test', () => {
    it('returns 404 for non-existent router', async () => {
      const res = await api('POST', '/api/routers/nonexistent12345/test', undefined, userToken)
      assert.equal(res.status, 404)
    })

    it('returns 404 when non-owner tries to test invisible personal router', async () => {
      const { id } = await createRouter(userToken, { name: 'Test Invisible Router' })
      const res = await api('POST', `/api/routers/${id}/test`, undefined, user2Token)
      assert.equal(res.status, 404)
    })

    it('connection test returns error for unreachable LLM endpoint', async () => {
      // Create a router pointing to a non-existent endpoint
      const { id } = await createRouter(userToken, {
        name: 'Unreachable LLM Router',
        llmBaseUrl: 'https://api.nonexistent-llm-service-xyz.invalid/v1',
      })
      const res = await api('POST', `/api/routers/${id}/test`, undefined, userToken)
      assert.equal(res.data.ok, false)
      assert.ok(res.data.error)
    })

    it('owner can test their own router', async () => {
      const { id } = await createRouter(userToken, { name: 'Owner Test Router' })
      // This will fail to connect but should return a proper error, not 403/404
      const res = await api('POST', `/api/routers/${id}/test`, undefined, userToken)
      // Expected to fail with connection error (not auth error)
      assert.equal(res.data.ok, false)
      assert.ok(res.data.error.includes('Connection') || res.data.error.includes('timeout'))
    })

    it('admin can test any router', async () => {
      const { id } = await createRouter(userToken, { name: 'Admin Test Router' })
      const res = await api('POST', `/api/routers/${id}/test`, undefined, adminToken)
      // Expected to fail with connection error (not auth error)
      assert.equal(res.data.ok, false)
      assert.ok(res.data.error)
    })
  })

  // ─── Edge Cases & Misc ───

  describe('Edge Cases', () => {
    it('rejects request with invalid ID format in path', async () => {
      // IDs must be alphanumeric/hyphen/underscore, max 30 chars
      const longId = 'a'.repeat(31)
      const res = await api('GET', `/api/routers/${longId}`, undefined, userToken)
      // validateIdParams middleware should reject IDs longer than 30 chars
      assert.equal(res.status, 400)
    })

    it('full CRUD lifecycle works end-to-end', async () => {
      // Create
      const createRes = await api(
        'POST',
        '/api/routers',
        {
          name: 'Lifecycle Router',
          llmBaseUrl: VALID_LLM_URL,
          llmApiKey: 'sk-lifecycle-key-ending-LC',
          llmModel: VALID_MODEL,
          description: 'Lifecycle test',
        },
        userToken,
      )
      assert.equal(createRes.status, 201)
      const routerId = createRes.data.data.id

      // Read
      const readRes = await api('GET', `/api/routers/${routerId}`, undefined, userToken)
      assert.equal(readRes.status, 200)
      assert.equal(readRes.data.data.name, 'Lifecycle Router')
      assert.equal(readRes.data.data.llmApiKey, '••••LC')

      // List
      const listRes = await api('GET', '/api/routers', undefined, userToken)
      assert.equal(listRes.status, 200)
      const found = listRes.data.data.find((r: any) => r.id === routerId)
      assert.ok(found)

      // Update
      const updateRes = await api(
        'PUT',
        `/api/routers/${routerId}`,
        { name: 'Updated Lifecycle Router', description: 'Updated' },
        userToken,
      )
      assert.equal(updateRes.status, 200)
      assert.equal(updateRes.data.data.name, 'Updated Lifecycle Router')

      // Delete
      const deleteRes = await api('DELETE', `/api/routers/${routerId}`, undefined, userToken)
      assert.equal(deleteRes.status, 200)

      // Verify deleted
      const finalRes = await api('GET', `/api/routers/${routerId}`, undefined, userToken)
      assert.equal(finalRes.status, 404)
    })

    it('created router has correct createdById matching the user', async () => {
      const { id } = await createRouter(userToken, { name: 'Owner Check Router' })
      // Admin can see the full record
      const res = await api('GET', `/api/routers/${id}`, undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.createdById, userId)
    })

    it('short API key is masked as ••••', async () => {
      // Key with <= 8 chars total should just show ••••
      const { id } = await createRouter(userToken, {
        name: 'Short Key Router',
        llmApiKey: 'shortkey',
      })
      const res = await api('GET', `/api/routers/${id}`, undefined, userToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.llmApiKey, '••••')
    })
  })
})
