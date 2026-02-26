import type { ApiResponse, Message } from '@agentim/shared'
import { wsClient } from './ws.js'

// Lazy import to avoid circular dependency (auth store imports api)
let _onAuthExpired: (() => void) | null = null
let _authExpiredFired = false
export function setOnAuthExpired(cb: () => void) {
  _onAuthExpired = cb
}

/** Fire auth-expired callback exactly once per session to prevent cascading logouts. */
function fireAuthExpired() {
  if (_authExpiredFired) return
  _authExpiredFired = true
  clearTokens()
  wsClient.disconnect()
  _onAuthExpired?.()
}

const BASE_URL = '/api'
const DEFAULT_TIMEOUT = 15_000
const UPLOAD_TIMEOUT = 120_000
const MAX_RETRIES = 2
const RETRY_BASE_DELAY = 500

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503])

// Access token lives in memory only — not accessible via XSS
// Refresh token is stored in a httpOnly Cookie managed by the server
let accessToken: string | null = null

// Callback invoked whenever the access token is set or refreshed.
// Used by the auth store to bump a tokenVersion counter so React
// components can reactively re-derive auth-gated upload URLs.
let _onTokenRefresh: (() => void) | null = null
export function setOnTokenRefresh(cb: () => void) {
  _onTokenRefresh = cb
}

// One-time migration: remove stale tokens from localStorage left by older versions
;(() => {
  try {
    localStorage.removeItem('agentim_rt')
    localStorage.removeItem('agentim_refresh_token')
    localStorage.removeItem('agentim_access_token')
  } catch {
    // localStorage may be unavailable in some environments
  }
})()

function getToken(): string | null {
  return accessToken
}

function setTokens(access: string) {
  accessToken = access
  // Keep WS client in sync so reconnections use the fresh token
  wsClient.updateToken(access)
  // Reset the auth-expired guard so future sessions can fire it again
  _authExpiredFired = false
  // Notify listeners (e.g. auth store tokenVersion) so components can re-derive upload URLs
  _onTokenRefresh?.()
}

function clearTokens() {
  accessToken = null
}

// Eagerly try to recover session on page load so the first request
// doesn't need to wait for a 401 → refresh round-trip.
let _initialRefreshDone = false
let _initialRefreshPromise: Promise<void> | null = null

async function ensureInitialRefresh(): Promise<void> {
  if (_initialRefreshDone) return
  if (_initialRefreshPromise) return _initialRefreshPromise

  _initialRefreshPromise = (async () => {
    if (!accessToken) {
      // Attempt to restore the session using the httpOnly Cookie
      await refreshAccessToken()
    }
    _initialRefreshDone = true
  })()

  try {
    await _initialRefreshPromise
  } finally {
    _initialRefreshPromise = null
  }
}

function withTimeout(
  signal?: AbortSignal | null,
  timeout = DEFAULT_TIMEOUT,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeout)
  const clear = () => clearTimeout(timer)
  controller.signal.addEventListener('abort', clear)
  if (signal) {
    signal.addEventListener('abort', () => {
      clear()
      controller.abort(signal.reason)
    })
  }
  return { signal: controller.signal, clear }
}

/**
 * Run an async function with automatic 401 → token-refresh → retry.
 * `fn` receives a `headers` record whose Authorization is always up-to-date.
 * `isUnauthorized` inspects the result to decide whether a refresh is needed.
 *
 * A 401 means the server rejected the request at the auth layer before
 * executing any side-effects, so retrying after a successful token refresh
 * is safe for all HTTP methods (including POST/PUT/DELETE).
 */
async function withAuthRetry<T>(
  headers: Record<string, string>,
  fn: (hdrs: Record<string, string>) => Promise<T>,
  isUnauthorized: (result: T) => boolean,
): Promise<T> {
  let result = await fn(headers)
  if (isUnauthorized(result)) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`
      result = await fn(headers)
    } else {
      fireAuthExpired()
    }
  }
  return result
}

let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const t = withTimeout(null, 10_000)
      // No body needed — the browser automatically sends the httpOnly Cookie
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        signal: t.signal,
      })
      t.clear()
      if (!res.ok) return false
      const data = await res.json()
      if (data.ok && data.data) {
        setTokens(data.data.accessToken)
        return true
      }
      return false
    } catch {
      return false
    }
  })()

  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal | null
  timeout?: number
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  // Ensure initial token recovery has completed before first request
  await ensureInitialRefresh()
  const { signal: userSignal, timeout = DEFAULT_TIMEOUT, ...init } = opts
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const method = (init.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET'
  const maxAttempts = canRetry ? MAX_RETRIES + 1 : 1

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const doFetch = async (hdrs: Record<string, string>) => {
        const t = withTimeout(userSignal, timeout)
        try {
          const res = await fetch(`${BASE_URL}${path}`, {
            ...init,
            headers: hdrs,
            signal: t.signal,
            credentials: 'include',
          })
          t.clear()
          return res
        } catch (err) {
          t.clear()
          throw err
        }
      }

      const res = await withAuthRetry(headers, doFetch, (r) => r.status === 401)

      if (canRetry && attempt < maxAttempts - 1 && RETRYABLE_STATUSES.has(res.status)) {
        await delay(RETRY_BASE_DELAY * 2 ** attempt)
        continue
      }

      return await res.json()
    } catch (err) {
      if (!canRetry || attempt >= maxAttempts - 1) {
        return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
      }
      await delay(RETRY_BASE_DELAY * 2 ** attempt)
    }
  }

  return { ok: false, error: 'Request failed after retries' }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface UploadOptions {
  signal?: AbortSignal | null
  onProgress?: (percent: number) => void
}

async function uploadFile<T>(
  path: string,
  file: File,
  options: UploadOptions = {},
): Promise<ApiResponse<T>> {
  const { signal: userSignal, onProgress } = options
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const formData = new FormData()
  formData.append('file', file)

  if (onProgress) {
    const doXhrUpload = (
      hdrs: Record<string, string>,
      body: FormData,
    ): Promise<{ status: number; data: ApiResponse<T> }> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${BASE_URL}${path}`)
        xhr.withCredentials = true
        Object.entries(hdrs).forEach(([k, v]) => xhr.setRequestHeader(k, v))

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
        })
        xhr.addEventListener('load', () => {
          try {
            resolve({ status: xhr.status, data: JSON.parse(xhr.responseText) })
          } catch {
            reject(new Error('Invalid response'))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('Upload failed')))
        xhr.addEventListener('timeout', () => reject(new Error('Upload timeout')))
        xhr.timeout = UPLOAD_TIMEOUT

        if (userSignal) {
          userSignal.addEventListener('abort', () => xhr.abort())
        }

        xhr.send(body)
      })

    const result = await withAuthRetry(
      headers,
      async (hdrs) => {
        const fd = new FormData()
        fd.append('file', file)
        return doXhrUpload(hdrs, fd)
      },
      (r) => r.status === 401,
    )
    return result.data
  }

  const res = await withAuthRetry(
    headers,
    async (hdrs) => {
      // Recreate FormData per attempt — some browsers don't allow reusing after fetch
      const fd = new FormData()
      fd.append('file', file)
      const t = withTimeout(userSignal, UPLOAD_TIMEOUT)
      try {
        const r = await fetch(`${BASE_URL}${path}`, {
          method: 'POST',
          headers: hdrs,
          body: fd,
          signal: t.signal,
          credentials: 'include',
        })
        t.clear()
        return r
      } catch (err) {
        t.clear()
        throw err
      }
    },
    (r) => r.status === 401,
  )

  return res.json()
}

export async function getThread(messageId: string): Promise<Message[]> {
  const res = await request<{ data: Message[] }>(`/messages/${messageId}/thread`)
  const data = res as unknown as { ok: boolean; data: Message[]; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to load thread')
  return data.data
}

export async function getReplyCount(messageId: string): Promise<number> {
  const res = await request<{ data: { count: number } }>(`/messages/${messageId}/replies/count`)
  const data = res as unknown as { ok: boolean; data: { count: number }; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to load reply count')
  return data.data.count
}

// Register token refresher so WS reconnections get a fresh token
wsClient.setTokenRefresher(async () => {
  const refreshed = await refreshAccessToken()
  return refreshed ? getToken() : null
})

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal | null }) => request<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts?: { signal?: AbortSignal | null }) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...opts }),
  put: <T>(path: string, body?: unknown, opts?: { signal?: AbortSignal | null }) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined, ...opts }),
  delete: <T>(path: string, opts?: { signal?: AbortSignal | null }) =>
    request<T>(path, { method: 'DELETE', ...opts }),
  upload: <T>(path: string, file: File, options?: UploadOptions) =>
    uploadFile<T>(path, file, options),
  setTokens,
  clearTokens,
  getToken,
  tryRefresh: refreshAccessToken,
  /** Mark the initial session-recovery attempt as done so subsequent request()
   *  calls skip the redundant ensureInitialRefresh() → /auth/refresh round-trip.
   *  Call this after a manual tryRefresh() (e.g. in loadUser) to avoid double-refreshing. */
  markInitialRefreshDone: () => {
    _initialRefreshDone = true
  },
}
