import { useState, useCallback, useEffect, useRef } from 'react'
import {
  loadConfig,
  clearConfig,
  hasAuthRevokedMarker,
  removeAuthRevokedMarker,
} from '../../config.js'
import { TokenManager } from '../../token-manager.js'

export interface AuthState {
  loggedIn: boolean
  serverUrl: string | null
  authRevoked: boolean
}

/** Check saved config for authentication state and provide login/logout. */
export function useAuth(): {
  auth: AuthState
  login: (
    serverUrl: string,
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  refresh: () => void
} {
  const check = (): AuthState => {
    if (hasAuthRevokedMarker()) {
      const config = loadConfig()
      return { loggedIn: false, authRevoked: true, serverUrl: config?.serverBaseUrl ?? null }
    }
    const config = loadConfig()
    if (!config) return { loggedIn: false, authRevoked: false, serverUrl: null }
    return { loggedIn: true, authRevoked: false, serverUrl: config.serverBaseUrl }
  }

  const [auth, setAuth] = useState<AuthState>(check)
  const authRef = useRef(auth)
  authRef.current = auth

  // Poll for auth-revoked marker changes (e.g. daemon entered recovery mode)
  useEffect(() => {
    const timer = setInterval(() => {
      const next = check()
      const prev = authRef.current
      if (
        next.loggedIn !== prev.loggedIn ||
        next.authRevoked !== prev.authRevoked ||
        next.serverUrl !== prev.serverUrl
      ) {
        setAuth(next)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  const login = useCallback(
    async (
      serverUrl: string,
      username: string,
      password: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const serverBaseUrl = serverUrl.replace(/\/+$/, '')
        const { accessToken, refreshToken } = await TokenManager.login(
          serverBaseUrl,
          username,
          password,
        )

        // Import saveConfig dynamically to avoid circular dep issues
        const { saveConfig } = await import('../../config.js')
        const { nanoid } = await import('nanoid')
        const existingConfig = loadConfig()
        const gatewayId = existingConfig?.gatewayId ?? nanoid()
        const wsUrl =
          serverBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/gateway'

        saveConfig({
          serverUrl: wsUrl,
          serverBaseUrl,
          token: accessToken,
          refreshToken,
          gatewayId,
        })
        removeAuthRevokedMarker()

        setAuth({ loggedIn: true, authRevoked: false, serverUrl: serverBaseUrl })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [],
  )

  const logout = useCallback(() => {
    clearConfig()
    removeAuthRevokedMarker()
    setAuth({ loggedIn: false, authRevoked: false, serverUrl: null })
  }, [])

  const refresh = useCallback(() => {
    setAuth(check())
  }, [])

  return { auth, login, logout, refresh }
}
