import type { ApiResponse } from '@agentim/shared'

const BASE_URL = '/api'

function getToken(): string | null {
  return localStorage.getItem('aim_access_token')
}

function setTokens(access: string, refresh: string) {
  localStorage.setItem('aim_access_token', access)
  localStorage.setItem('aim_refresh_token', refresh)
}

function clearTokens() {
  localStorage.removeItem('aim_access_token')
  localStorage.removeItem('aim_refresh_token')
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('aim_refresh_token')
  if (!refreshToken) return false

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
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
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res = await fetch(`${BASE_URL}${path}`, { ...opts, headers })

  if (res.status === 401 && token) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`
      res = await fetch(`${BASE_URL}${path}`, { ...opts, headers })
    }
  }

  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  setTokens,
  clearTokens,
  getToken,
}
