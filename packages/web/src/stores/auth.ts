import { create } from 'zustand'
import { api, setOnAuthExpired, setOnTokenRefresh } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'
import { resetAllStores } from './reset.js'
import { clearAllDrafts } from '../lib/message-cache.js'
import { useTokenVersionStore } from './tokenVersion.js'
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
  totpRequired: boolean
  totpToken: string | null
  login: (username: string, password: string) => Promise<void>
  verifyTotp: (code: string) => Promise<void>
  clearTotpState: () => void
  logout: () => Promise<void>
  loadUser: () => Promise<void>
  updateUser: (data: Partial<AuthUser>) => void
}

let _logoutPromise: Promise<void> | null = null

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  totpRequired: false,
  totpToken: null,

  login: async (username, password) => {
    const res = await api.post<{
      user?: AuthUser
      accessToken?: string
      refreshToken?: string
      totpRequired?: boolean
      totpToken?: string
    }>('/auth/login', { username, password })

    if (!res.ok || !res.data) throw new Error(res.error ?? 'Login failed')

    // If 2FA is enabled, store the challenge token and wait for TOTP verification
    if (res.data.totpRequired && res.data.totpToken) {
      set({ totpRequired: true, totpToken: res.data.totpToken })
      return
    }

    // refreshToken is now stored as an httpOnly Cookie by the server.
    // We only keep the access token in memory.
    api.setTokens(res.data.accessToken!)
    set({ user: res.data.user!, totpRequired: false, totpToken: null })
    wsClient.connect(res.data.accessToken!)
  },

  verifyTotp: async (code) => {
    const totpToken = useAuthStore.getState().totpToken
    if (!totpToken) throw new Error('No TOTP challenge in progress')

    const res = await api.post<{
      user: AuthUser
      accessToken: string
      refreshToken: string
    }>('/auth/verify-totp', { totpToken, code })

    if (!res.ok || !res.data) throw new Error(res.error ?? 'TOTP verification failed')

    api.setTokens(res.data.accessToken)
    set({ user: res.data.user, totpRequired: false, totpToken: null })
    wsClient.connect(res.data.accessToken)
  },

  clearTotpState: () => {
    set({ totpRequired: false, totpToken: null })
  },

  logout: async () => {
    if (_logoutPromise) return _logoutPromise
    _logoutPromise = (async () => {
      try {
        await api.post('/auth/logout').catch(() => {})
        api.clearTokens()
        wsClient.disconnect()
        resetAllStores()
        // Clear all drafts from IndexedDB
        clearAllDrafts().catch(() => {})
        set({ user: null })
        // Signal other tabs to logout via storage event
        try {
          localStorage.setItem(LOGOUT_KEY, Date.now().toString())
          localStorage.removeItem(LOGOUT_KEY)
        } catch {
          // localStorage may be unavailable
        }
      } finally {
        _logoutPromise = null
      }
    })()
    return _logoutPromise
  },

  loadUser: async () => {
    let token = api.getToken()

    // Access token is in-memory only; on page reload it's null.
    // Try to restore the session via refresh token.
    if (!token) {
      const refreshed = await api.tryRefresh()
      // Mark the initial refresh as done so request() skips the redundant
      // ensureInitialRefresh() → /auth/refresh call on the very next API
      // request (e.g. the login POST). Without this, every login attempt
      // makes 3 auth-endpoint calls (refresh + refresh + login) instead of 2,
      // which can exhaust the rate limit and cause spurious login failures.
      api.markInitialRefreshDone()
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
  resetAllStores()
  useAuthStore.setState({ user: null })
})

// Bump tokenVersion whenever the access token is set/refreshed so that
// components using useUploadUrl() re-render with a fresh token in the URL.
setOnTokenRefresh(() => {
  useTokenVersionStore.getState().bump()
})

// Cross-tab logout: when another tab logs out, sync the state here.
// The logout() function writes a sentinel key; other tabs detect it via 'storage' event.
const LOGOUT_KEY = 'agentim:logout'

// Module-level singleton listener: this runs once when the module is imported.
// In an SPA only one auth store instance exists, so a single global listener is correct.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOGOUT_KEY && e.newValue) {
      // Another tab logged out — clear local state without calling the API again
      api.clearTokens()
      wsClient.disconnect()
      resetAllStores()
      useAuthStore.setState({ user: null })
    }
  })
}
