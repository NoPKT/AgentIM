import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock ws.js before importing api
vi.mock('./ws.js', () => ({
  wsClient: {
    disconnect: vi.fn(),
    updateToken: vi.fn(),
    setTokenRefresher: vi.fn(),
  },
}))

// Mock location
Object.defineProperty(globalThis, 'location', {
  value: { protocol: 'http:', host: 'localhost:3000', origin: 'http://localhost:3000' },
  writable: true,
  configurable: true,
})

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Dynamic import so module state resets between describe blocks where needed
let api: typeof import('./api.js')['api']
let setOnAuthExpired: typeof import('./api.js')['setOnAuthExpired']

beforeEach(async () => {
  mockFetch.mockReset()
  vi.clearAllMocks()
  // Re-import to reset module-level state (_initialRefreshDone, accessToken, etc.)
  vi.resetModules()
  vi.mock('./ws.js', () => ({
    wsClient: {
      disconnect: vi.fn(),
      updateToken: vi.fn(),
      setTokenRefresher: vi.fn(),
    },
  }))
  const mod = await import('./api.js')
  api = mod.api
  setOnAuthExpired = mod.setOnAuthExpired
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

describe('api.setTokens / api.clearTokens', () => {
  it('stores access token in memory', () => {
    api.setTokens('access-abc')
    expect(api.getToken()).toBe('access-abc')
  })

  it('clears access token from memory', () => {
    api.setTokens('access-abc')
    api.clearTokens()
    expect(api.getToken()).toBeNull()
  })
})

describe('api request 401 → auto refresh', () => {
  it('refreshes token and retries on 401', async () => {
    // Skip initial refresh (already have a token)
    api.setTokens('old-token')

    mockFetch
      // First call returns 401
      .mockImplementationOnce(() => makeResponse({ ok: false }, 401))
      // refresh call — Cookie-based, no body
      .mockImplementationOnce(() =>
        makeResponse({ ok: true, data: { accessToken: 'new-token', refreshToken: 'rt' } }),
      )
      // retry with new token
      .mockImplementationOnce(() => makeResponse({ ok: true, data: { id: '1' } }))

    const result = await api.get('/users/me')
    expect(result).toEqual({ ok: true, data: { id: '1' } })
    expect(api.getToken()).toBe('new-token')
  })

  it('fires auth expired when refresh fails', async () => {
    api.setTokens('old-token')
    const onExpired = vi.fn()
    setOnAuthExpired(onExpired)

    mockFetch
      // main request → 401
      .mockImplementationOnce(() => makeResponse({ ok: false }, 401))
      // refresh → also fails
      .mockImplementationOnce(() => makeResponse({ ok: false }, 401))

    await api.get('/users/me')
    expect(onExpired).toHaveBeenCalled()
  })
})

describe('ensureInitialRefresh', () => {
  it('attempts a silent refresh on first request when no access token', async () => {
    // No token set — ensureInitialRefresh should call /auth/refresh via Cookie
    mockFetch
      // initial refresh attempt (no body, Cookie-based)
      .mockImplementationOnce(() =>
        makeResponse({ ok: true, data: { accessToken: 'restored-token', refreshToken: 'rt' } }),
      )
      // actual GET /users/me
      .mockImplementationOnce(() => makeResponse({ ok: true, data: { id: '42' } }))

    const result = await api.get('/users/me')
    expect(api.getToken()).toBe('restored-token')
    expect(result).toEqual({ ok: true, data: { id: '42' } })
  })

  it('continues without token when initial refresh fails', async () => {
    mockFetch
      // refresh fails (no valid Cookie)
      .mockImplementationOnce(() => makeResponse({ ok: false }, 401))
      // actual request proceeds without auth header
      .mockImplementationOnce(() => makeResponse({ ok: true, data: [] }))

    const result = await api.get('/rooms')
    expect(result).toEqual({ ok: true, data: [] })
    expect(api.getToken()).toBeNull()
  })
})
