import { loadConfig, saveConfig, type GatewayConfig } from './config.js'

export class TokenManager {
  private config: GatewayConfig

  constructor(config: GatewayConfig) {
    this.config = config
  }

  get accessToken(): string {
    return this.config.token
  }

  /** Refresh the access token using the refresh token via HTTP API */
  async refresh(): Promise<string> {
    const res = await fetch(`${this.config.serverBaseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.config.refreshToken }),
    })

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status}`)
    }

    const json = (await res.json()) as {
      ok: boolean
      data?: { accessToken: string; refreshToken: string }
      error?: string
    }
    if (!json.ok || !json.data) {
      throw new Error(`Token refresh failed: ${json.error ?? 'unknown error'}`)
    }

    // Update config with new tokens
    this.config.token = json.data.accessToken
    this.config.refreshToken = json.data.refreshToken
    saveConfig(this.config)

    console.log('[TokenManager] Tokens refreshed and saved')
    return json.data.accessToken
  }

  /** Login with username/password, returns config with tokens */
  static async login(
    serverBaseUrl: string,
    username: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await fetch(`${serverBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      throw new Error(`Login failed: ${res.status}`)
    }

    const json = (await res.json()) as {
      ok: boolean
      data?: { accessToken: string; refreshToken: string }
      error?: string
    }
    if (!json.ok || !json.data) {
      throw new Error(`Login failed: ${json.error ?? 'unknown error'}`)
    }

    return {
      accessToken: json.data.accessToken,
      refreshToken: json.data.refreshToken,
    }
  }
}
