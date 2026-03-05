import { saveConfig, loadConfig, type GatewayConfig } from './config.js'
import { createLogger } from './lib/logger.js'

const log = createLogger('TokenManager')

export class TokenManager {
  private config: GatewayConfig

  constructor(config: GatewayConfig) {
    this.config = config
  }

  get accessToken(): string {
    return this.config.token
  }

  /** Replace the internal config reference (used during auth-revoked recovery). */
  updateTokens(newConfig: GatewayConfig): void {
    this.config = newConfig
  }

  /**
   * Check if another process has refreshed the tokens by reading config from disk.
   * If the refresh token on disk differs from ours, adopt the new tokens.
   * Returns the new access token if adopted, or null otherwise.
   */
  private adoptTokensFromDisk(): string | null {
    const diskConfig = loadConfig()
    if (diskConfig && diskConfig.refreshToken !== this.config.refreshToken) {
      this.config.token = diskConfig.token
      this.config.refreshToken = diskConfig.refreshToken
      log.info('Picked up tokens refreshed by another process')
      return diskConfig.token
    }
    return null
  }

  /** Refresh the access token using the refresh token via HTTP API.
   *  Pass an AbortSignal to cancel in-flight retries and requests. */
  async refresh(signal?: AbortSignal): Promise<string> {
    const MAX_RETRIES = 6
    const BASE_DELAY = 2000
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error('Token refresh aborted')

      if (attempt > 0) {
        // Before retrying, check if another process already refreshed the tokens
        const adopted = this.adoptTokensFromDisk()
        if (adopted) return adopted

        // Exponential backoff with jitter: 2s, 4s, 8s + random
        const delay = BASE_DELAY * Math.pow(2, attempt - 1) + Math.random() * 1000
        log.warn(`Token refresh retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms...`)
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Token refresh aborted'))
            return
          }
          const timer = setTimeout(resolve, delay)
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('Token refresh aborted'))
            },
            { once: true },
          )
        })
      }

      if (signal?.aborted) throw new Error('Token refresh aborted')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      // Forward external abort to the per-request controller
      const forwardAbort = () => controller.abort()
      signal?.addEventListener('abort', forwardAbort, { once: true })
      try {
        const res = await fetch(`${this.config.serverBaseUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.config.refreshToken }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const status = res.status
          // Client errors (except timeout/rate-limit) are permanent — don't retry
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            // Before failing permanently, check if another process refreshed
            const adopted = this.adoptTokensFromDisk()
            if (adopted) return adopted
            throw new Error(`Token refresh failed permanently: ${status}`)
          }
          lastError = new Error(`Token refresh failed: ${status}`)
          continue
        }

        const json = (await res.json()) as {
          ok: boolean
          data?: { accessToken: string; refreshToken: string }
          error?: string
        }
        if (!json.ok || !json.data) {
          lastError = new Error(`Token refresh failed: ${json.error ?? 'unknown error'}`)
          continue
        }

        // Update config with new tokens
        this.config.token = json.data.accessToken
        this.config.refreshToken = json.data.refreshToken
        saveConfig(this.config)

        log.info('Tokens refreshed and saved')
        return json.data.accessToken
      } catch (err) {
        if (signal?.aborted) throw new Error('Token refresh aborted', { cause: err })
        lastError = err instanceof Error ? err : new Error(String(err))
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', forwardAbort)
      }
    }

    throw lastError ?? new Error('Token refresh failed after retries')
  }

  /** Login with username/password, returns config with tokens */
  static async login(
    serverBaseUrl: string,
    username: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(`${serverBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

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
