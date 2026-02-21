import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from './auth.js'

// Mock api module
vi.mock('../lib/api.js', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    clearTokens: vi.fn(),
    setTokens: vi.fn(),
    getToken: vi.fn(),
    tryRefresh: vi.fn(),
  },
  setOnAuthExpired: vi.fn(),
  setOnTokenRefresh: vi.fn(),
}))

// Mock ws client
vi.mock('../lib/ws.js', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    updateToken: vi.fn(),
    setTokenRefresher: vi.fn(),
  },
}))

// Mock dependent stores
vi.mock('./chat.js', () => ({
  useChatStore: {
    getState: () => ({ reset: vi.fn() }),
  },
}))
vi.mock('./agents.js', () => ({
  useAgentStore: { setState: vi.fn() },
}))
vi.mock('./routers.js', () => ({
  useRouterStore: { setState: vi.fn() },
}))

import { api } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'

const mockApi = api as unknown as {
  post: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  clearTokens: ReturnType<typeof vi.fn>
  setTokens: ReturnType<typeof vi.fn>
  getToken: ReturnType<typeof vi.fn>
  tryRefresh: ReturnType<typeof vi.fn>
}

const mockWs = wsClient as unknown as {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isLoading: true })
})

const fakeUser = {
  id: 'u1',
  username: 'alice',
  displayName: 'Alice',
  role: 'user' as const,
}

describe('login', () => {
  it('sets user and connects WS on success', async () => {
    mockApi.post.mockResolvedValueOnce({
      ok: true,
      data: { user: fakeUser, accessToken: 'at', refreshToken: 'rt' },
    })

    await useAuthStore.getState().login('alice', 'password')

    expect(mockApi.setTokens).toHaveBeenCalledWith('at')
    expect(mockWs.connect).toHaveBeenCalledWith('at')
    expect(useAuthStore.getState().user).toEqual(fakeUser)
  })

  it('throws on login failure', async () => {
    mockApi.post.mockResolvedValueOnce({ ok: false, error: 'Invalid credentials' })

    await expect(useAuthStore.getState().login('alice', 'wrong')).rejects.toThrow(
      'Invalid credentials',
    )
  })
})

describe('logout', () => {
  it('clears user state and disconnects WS', async () => {
    useAuthStore.setState({ user: fakeUser })
    mockApi.post.mockResolvedValueOnce({ ok: true })

    await useAuthStore.getState().logout()

    expect(mockApi.clearTokens).toHaveBeenCalled()
    expect(mockWs.disconnect).toHaveBeenCalled()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('loadUser', () => {
  it('restores session via refresh when no access token', async () => {
    mockApi.getToken.mockReturnValue(null)
    mockApi.tryRefresh.mockResolvedValueOnce(true)
    mockApi.getToken.mockReturnValue('at')
    mockApi.get.mockResolvedValueOnce({ ok: true, data: fakeUser })

    await useAuthStore.getState().loadUser()

    expect(useAuthStore.getState().user).toEqual(fakeUser)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('sets isLoading=false when no token and refresh fails', async () => {
    mockApi.getToken.mockReturnValue(null)
    mockApi.tryRefresh.mockResolvedValueOnce(false)
    mockApi.getToken.mockReturnValue(null)

    await useAuthStore.getState().loadUser()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isLoading).toBe(false)
  })
})
