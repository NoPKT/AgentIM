import { create } from 'zustand'
import { api, setOnAuthExpired } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'
import { useChatStore } from './chat.js'
import { useAgentStore } from './agents.js'
import { useRouterStore } from './routers.js'
import type { UserRole } from '@agentim/shared'

interface AuthUser {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
  role: UserRole
}

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  loadUser: () => Promise<void>
  updateUser: (data: Partial<AuthUser>) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (username, password) => {
    const res = await api.post<{
      user: AuthUser
      accessToken: string
      refreshToken: string
    }>('/auth/login', { username, password })

    if (!res.ok || !res.data) throw new Error(res.error ?? 'Login failed')

    api.setTokens(res.data.accessToken, res.data.refreshToken)
    set({ user: res.data.user })
    wsClient.connect(res.data.accessToken)
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => {})
    api.clearTokens()
    wsClient.disconnect()
    useChatStore.getState().reset()
    useAgentStore.setState({ agents: [], sharedAgents: [], isLoading: false, loadError: false })
    useRouterStore.setState({ routers: [], loading: false })
    // Clear all draft entries from localStorage
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith('draft:')) localStorage.removeItem(key)
    }
    set({ user: null })
  },

  loadUser: async () => {
    let token = api.getToken()

    // Access token is in-memory only; on page reload it's null.
    // Try to restore the session via refresh token.
    if (!token) {
      const refreshed = await api.tryRefresh()
      if (refreshed) {
        token = api.getToken()
      }
    }

    if (!token) {
      set({ isLoading: false })
      return
    }

    try {
      const res = await api.get<AuthUser>('/users/me')
      if (res.ok && res.data) {
        set({ user: res.data, isLoading: false })
        wsClient.connect(token!)
      } else {
        api.clearTokens()
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  updateUser: (data) => {
    set((state) => ({
      user: state.user ? { ...state.user, ...data } : null,
    }))
  },
}))

// Register callback so api.ts can reset auth state when token refresh fails
setOnAuthExpired(() => {
  useChatStore.getState().reset()
  useAgentStore.setState({ agents: [], sharedAgents: [], isLoading: false, loadError: false })
  useRouterStore.setState({ routers: [], loading: false })
  useAuthStore.setState({ user: null })
})
