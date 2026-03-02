import { loadConfig } from '../config.js'
import { TokenManager } from '../token-manager.js'
import { createLogger } from './logger.js'

const log = createLogger('ServerAPI')

/**
 * Lightweight HTTP client for server API calls from the TUI.
 * Uses saved config token and refreshes on 401.
 */
export class ServerApi {
  private config = loadConfig()
  private tokenManager: TokenManager | null = null

  constructor() {
    if (this.config) {
      this.tokenManager = new TokenManager(this.config)
    }
  }

  get isAuthenticated(): boolean {
    return this.config !== null && this.tokenManager !== null
  }

  get serverBaseUrl(): string | null {
    return this.config?.serverBaseUrl ?? null
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
    if (!this.config || !this.tokenManager) {
      return { ok: false, status: 0, error: 'Not authenticated' }
    }

    const url = `${this.config.serverBaseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokenManager.accessToken}`,
      'Content-Type': 'application/json',
    }

    try {
      let res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      // Refresh token on 401 and retry once
      if (res.status === 401 && this.config.refreshToken) {
        try {
          await this.tokenManager.refresh()
          headers.Authorization = `Bearer ${this.tokenManager.accessToken}`
          res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          })
        } catch {
          return { ok: false, status: 401, error: 'Token refresh failed' }
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, status: res.status, error: text || res.statusText }
      }

      const data = await res.json().catch(() => null)
      return { ok: true, status: res.status, data }
    } catch (err) {
      log.warn(`Request failed: ${method} ${path} — ${err instanceof Error ? err.message : err}`)
      return { ok: false, status: 0, error: 'Server unreachable' }
    }
  }

  /** Rename an agent on the server. */
  async renameAgent(agentId: string, newName: string): Promise<{ ok: boolean; error?: string }> {
    const result = await this.request('PUT', `/api/agents/${agentId}`, { name: newName })
    return { ok: result.ok, error: result.error }
  }
}
