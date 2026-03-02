import { useState, useCallback } from 'react'
import { loadConfig, clearConfig } from '../../config.js'
import { TokenManager } from '../../token-manager.js'

export interface AuthState {
  loggedIn: boolean
  serverUrl: string | null
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
    const config = loadConfig()
    if (!config) return { loggedIn: false, serverUrl: null }
    return { loggedIn: true, serverUrl: config.serverBaseUrl }
  }

  const [auth, setAuth] = useState<AuthState>(check)

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

        setAuth({ loggedIn: true, serverUrl: serverBaseUrl })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [],
  )

  const logout = useCallback(() => {
    clearConfig()
    setAuth({ loggedIn: false, serverUrl: null })
  }, [])

  const refresh = useCallback(() => {
    setAuth(check())
  }, [])

  return { auth, login, logout, refresh }
}
