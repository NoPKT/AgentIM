import { create } from 'zustand'
import { api } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'

interface AuthUser {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
}

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, displayName?: string) => Promise<void>
  logout: () => Promise<void>
  loadUser: () => Promise<void>
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

  register: async (username, password, displayName) => {
    const res = await api.post<{
      user: AuthUser
      accessToken: string
      refreshToken: string
    }>('/auth/register', { username, password, displayName })

    if (!res.ok || !res.data) throw new Error(res.error ?? 'Registration failed')

    api.setTokens(res.data.accessToken, res.data.refreshToken)
    set({ user: res.data.user })
    wsClient.connect(res.data.accessToken)
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => {})
    api.clearTokens()
    wsClient.disconnect()
    set({ user: null })
  },

  loadUser: async () => {
    const token = api.getToken()
    if (!token) {
      set({ isLoading: false })
      return
    }

    try {
      const res = await api.get<AuthUser>('/users/me')
      if (res.ok && res.data) {
        set({ user: res.data, isLoading: false })
        wsClient.connect(token)
      } else {
        api.clearTokens()
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },
}))
