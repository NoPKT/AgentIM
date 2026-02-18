import type { ApiResponse } from '@agentim/shared'
import { wsClient } from './ws.js'

// Lazy import to avoid circular dependency (auth store imports api)
let _onAuthExpired: (() => void) | null = null
export function setOnAuthExpired(cb: () => void) {
  _onAuthExpired = cb
}

const BASE_URL = '/api'
const DEFAULT_TIMEOUT = 15_000
const UPLOAD_TIMEOUT = 120_000
const MAX_RETRIES = 2
const RETRY_BASE_DELAY = 500

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503])

// Access token lives in memory only — not accessible via XSS to localStorage
let accessToken: string | null = null

function getToken(): string | null {
  return accessToken
}

function setTokens(access: string, refresh: string) {
  accessToken = access
  localStorage.setItem('agentim_refresh_token', refresh)
  // Keep WS client in sync so reconnections use the fresh token
  wsClient.updateToken(access)
}

function clearTokens() {
  accessToken = null
  localStorage.removeItem('agentim_refresh_token')
  // Clean up legacy key if present
  localStorage.removeItem('agentim_access_token')
}

function withTimeout(signal?: AbortSignal | null, timeout = DEFAULT_TIMEOUT): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeout)
  controller.signal.addEventListener('abort', () => clearTimeout(timer))
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      controller.abort(signal.reason)
    })
  }
  return controller.signal
}

let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem('agentim_refresh_token')
    if (!refreshToken) return false

    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: withTimeout(null, 10_000),
      })
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
      const signal = withTimeout(userSignal, timeout)
      let res = await fetch(`${BASE_URL}${path}`, { ...init, headers, signal })

      if (res.status === 401 && token) {
        const refreshed = await refreshAccessToken()
        if (refreshed) {
          headers['Authorization'] = `Bearer ${getToken()}`
          res = await fetch(`${BASE_URL}${path}`, {
            ...init,
            headers,
            signal: withTimeout(userSignal, timeout),
          })
        } else {
          // Refresh failed — clear stale tokens, disconnect WS, and reset auth state
          clearTokens()
          wsClient.disconnect()
          _onAuthExpired?.()
        }
      }

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
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE_URL}${path}`)
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      })
      xhr.addEventListener('load', () => {
        try {
          resolve(JSON.parse(xhr.responseText))
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

      xhr.send(formData)
    })
  }

  const signal = withTimeout(userSignal, UPLOAD_TIMEOUT)

  let res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData, signal })

  if (res.status === 401 && token) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`
      // Recreate FormData — some browsers don't allow reusing after fetch
      const retryFormData = new FormData()
      retryFormData.append('file', file)
      res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: retryFormData,
        signal: withTimeout(userSignal, UPLOAD_TIMEOUT),
      })
    } else {
      clearTokens()
      wsClient.disconnect()
      _onAuthExpired?.()
    }
  }

  return res.json()
}

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
