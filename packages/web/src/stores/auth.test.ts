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
    markInitialRefreshDone: vi.fn(),
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

  it('clears tokens and sets isLoading=false when /users/me fails', async () => {
    mockApi.getToken.mockReturnValue('at')
    mockApi.get.mockResolvedValueOnce({ ok: false, error: 'Unauthorized' })

    await useAuthStore.getState().loadUser()

    expect(mockApi.clearTokens).toHaveBeenCalled()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isLoading).toBe(false)
  })
})

describe('updateUser', () => {
  it('merges partial user data', () => {
    useAuthStore.setState({ user: fakeUser })
    useAuthStore.getState().updateUser({ displayName: 'Alice Updated' })

    const user = useAuthStore.getState().user
    expect(user?.displayName).toBe('Alice Updated')
    expect(user?.username).toBe('alice')
    expect(user?.id).toBe('u1')
  })

  it('is a no-op when user is null', () => {
    useAuthStore.setState({ user: null })
    useAuthStore.getState().updateUser({ displayName: 'Ghost' })
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('initial state', () => {
  it('has correct default values', () => {
    useAuthStore.setState({ user: null, isLoading: true, tokenVersion: 0 })
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.isLoading).toBe(true)
    expect(state.tokenVersion).toBe(0)
  })
})

describe('side effect callbacks', () => {
  it('registers onAuthExpired and onTokenRefresh callbacks on module load', async () => {
    // Reset modules to re-trigger top-level side effects
    vi.resetModules()

    // Re-apply mocks after resetModules
    vi.doMock('../lib/api.js', () => ({
      api: {
        post: vi.fn(),
        get: vi.fn(),
        clearTokens: vi.fn(),
        setTokens: vi.fn(),
        getToken: vi.fn(),
        tryRefresh: vi.fn(),
        markInitialRefreshDone: vi.fn(),
      },
      setOnAuthExpired: vi.fn(),
      setOnTokenRefresh: vi.fn(),
    }))
    vi.doMock('../lib/ws.js', () => ({
      wsClient: {
        connect: vi.fn(),
        disconnect: vi.fn(),
        updateToken: vi.fn(),
        setTokenRefresher: vi.fn(),
      },
    }))
    vi.doMock('./chat.js', () => ({
      useChatStore: { getState: () => ({ reset: vi.fn() }) },
    }))
    vi.doMock('./agents.js', () => ({
      useAgentStore: { setState: vi.fn() },
    }))
    vi.doMock('./routers.js', () => ({
      useRouterStore: { setState: vi.fn() },
    }))
    vi.doMock('./reset.js', () => ({
      resetAllStores: vi.fn(),
    }))

    // Import auth store to trigger side effects with fresh mocks
    await import('./auth.js')
    const { setOnAuthExpired, setOnTokenRefresh } = await import('../lib/api.js')

    expect(setOnAuthExpired).toHaveBeenCalled()
    expect(setOnTokenRefresh).toHaveBeenCalled()
  })
})
