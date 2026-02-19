import type { ApiResponse } from '@agentim/shared'
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

// Access token lives in memory only — not accessible via XSS to localStorage
let accessToken: string | null = null

// Simple obfuscation for refresh token storage — not encryption, but raises the
// bar compared to plaintext localStorage. Deters casual XSS exfiltration.
const _STORAGE_KEY = 'agentim_rt'
function _obfuscate(token: string): string {
  // XOR with a fixed per-origin key derived from the page origin
  const key = btoa(location.origin).slice(0, 16)
  let result = ''
  for (let i = 0; i < token.length; i++) {
    result += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return btoa(result)
}
function _deobfuscate(encoded: string): string | null {
  try {
    const decoded = atob(encoded)
    const key = btoa(location.origin).slice(0, 16)
    let result = ''
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return result
  } catch {
    return null
  }
}
function _getStoredRefreshToken(): string | null {
  // Try new obfuscated key first, then fall back to legacy plaintext key
  const obfuscated = localStorage.getItem(_STORAGE_KEY)
  if (obfuscated) return _deobfuscate(obfuscated)
  const legacy = localStorage.getItem('agentim_refresh_token')
  if (legacy) {
    // Migrate to obfuscated storage
    localStorage.setItem(_STORAGE_KEY, _obfuscate(legacy))
    localStorage.removeItem('agentim_refresh_token')
    return legacy
  }
  return null
}

function getToken(): string | null {
  return accessToken
}

function setTokens(access: string, refresh: string) {
  accessToken = access
  localStorage.setItem(_STORAGE_KEY, _obfuscate(refresh))
  // Keep WS client in sync so reconnections use the fresh token
  wsClient.updateToken(access)
  // Reset the auth-expired guard so future sessions can fire it again
  _authExpiredFired = false
}

function clearTokens() {
  accessToken = null
  localStorage.removeItem(_STORAGE_KEY)
  // Clean up legacy keys if present
  localStorage.removeItem('agentim_refresh_token')
  localStorage.removeItem('agentim_access_token')
}

// Eagerly try to recover session on page load so the first request
// doesn't need to wait for a 401 → refresh round-trip.
let _initialRefreshDone = false
let _initialRefreshPromise: Promise<void> | null = null

async function ensureInitialRefresh(): Promise<void> {
  if (_initialRefreshDone) return
  if (_initialRefreshPromise) return _initialRefreshPromise

  _initialRefreshPromise = (async () => {
    if (!accessToken && _getStoredRefreshToken()) {
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

let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = _getStoredRefreshToken()
    if (!refreshToken) return false

    try {
      const t = withTimeout(null, 10_000)
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: t.signal,
      })
      t.clear()
      if (!res.ok) return false
      const data = await res.json()
      if (data.ok && data.data) {
        setTokens(data.data.accessToken, data.data.refreshToken)
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
    const t = withTimeout(userSignal, timeout)
    try {
      let res = await fetch(`${BASE_URL}${path}`, { ...init, headers, signal: t.signal })

      if (res.status === 401 && (token || _getStoredRefreshToken())) {
        t.clear()
        const refreshed = await refreshAccessToken()
        if (refreshed) {
          headers['Authorization'] = `Bearer ${getToken()}`
          const t2 = withTimeout(userSignal, timeout)
          res = await fetch(`${BASE_URL}${path}`, {
            ...init,
            headers,
            signal: t2.signal,
          })
          t2.clear()
        } else {
          // Refresh failed — clear stale tokens, disconnect WS, and reset auth state
          fireAuthExpired()
        }
      }

      t.clear()

      if (canRetry && attempt < maxAttempts - 1 && RETRYABLE_STATUSES.has(res.status)) {
        await delay(RETRY_BASE_DELAY * 2 ** attempt)
        continue
      }

      return await res.json()
    } catch (err) {
      t.clear()
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

    const result = await doXhrUpload(headers, formData)

    // Handle 401 → refresh → retry, same as the fetch branch
    if (result.status === 401 && (token || _getStoredRefreshToken())) {
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        headers['Authorization'] = `Bearer ${getToken()}`
        const retryFormData = new FormData()
        retryFormData.append('file', file)
        const retryResult = await doXhrUpload(headers, retryFormData)
        return retryResult.data
      } else {
        fireAuthExpired()
      }
    }
    return result.data
  }

  const t = withTimeout(userSignal, UPLOAD_TIMEOUT)

  let res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData, signal: t.signal })
  t.clear()

  if (res.status === 401 && (token || _getStoredRefreshToken())) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`
      // Recreate FormData — some browsers don't allow reusing after fetch
      const retryFormData = new FormData()
      retryFormData.append('file', file)
      const t2 = withTimeout(userSignal, UPLOAD_TIMEOUT)
      res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: retryFormData,
        signal: t2.signal,
      })
      t2.clear()
    } else {
      fireAuthExpired()
    }
  }

  return res.json()
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
}
