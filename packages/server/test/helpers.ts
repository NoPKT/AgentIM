import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import pg from 'pg'
import WebSocket from 'ws'

let serverProcess: ChildProcess | null = null
let testDbName: string | null = null
let testUploadDir: string | null = null

export const TEST_PORT = 3999
export const BASE_URL = `http://localhost:${TEST_PORT}`
export const WS_CLIENT_URL = `ws://localhost:${TEST_PORT}/ws/client`
export const WS_GATEWAY_URL = `ws://localhost:${TEST_PORT}/ws/gateway`

const PG_BASE_URL = process.env.TEST_PG_URL ?? 'postgresql://postgres:postgres@localhost:5432'
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1'

export async function startServer(): Promise<void> {
  // Create a unique test database
  testDbName = `agentim_test_${Date.now()}`
  const client = new pg.Client({ connectionString: `${PG_BASE_URL}/postgres` })
  await client.connect()
  await client.query(`CREATE DATABASE "${testDbName}"`)
  await client.end()

  const databaseUrl = `${PG_BASE_URL}/${testDbName}`

  // Use a temporary directory for uploads to avoid polluting the project
  testUploadDir = mkdtempSync(join(tmpdir(), 'agentim-test-uploads-'))

  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATABASE_URL: databaseUrl,
        REDIS_URL: REDIS_URL,
        JWT_SECRET: 'test-secret-for-tests',
        CORS_ORIGIN: '*',
        NODE_ENV: 'test',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'AdminPass123',
        AGENT_RATE_LIMIT_MAX: '5',
        UPLOAD_DIR: testUploadDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Server startup timeout'))
    }, 15000)

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (text.toLowerCase().includes('running at') && !started) {
        started = true
        clearTimeout(timeout)
        // Give it a moment to fully initialize
        setTimeout(resolve, 500)
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      // Suppress normal stderr output during tests
    })

    serverProcess.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

export async function stopServer(): Promise<void> {
  resetAdminToken()
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      serverProcess?.on('exit', resolve)
      setTimeout(resolve, 3000)
    })
    serverProcess = null
  }

  // Clean up test database
  if (testDbName) {
    try {
      const client = new pg.Client({ connectionString: `${PG_BASE_URL}/postgres` })
      await client.connect()
      // Terminate connections to the test database before dropping
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [testDbName],
      )
      await client.query(`DROP DATABASE IF EXISTS "${testDbName}"`)
      await client.end()
    } catch {
      // Ignore cleanup errors
    }
    testDbName = null
  }

  // Clean up test upload directory
  if (testUploadDir) {
    try {
      rmSync(testUploadDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    testUploadDir = null
  }

  // Flush test Redis DB
  try {
    const { default: Redis } = await import('ioredis')
    const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
    redis.on('error', () => {}) // Suppress unhandled event emitter errors
    await redis.connect()
    await redis.flushdb()
    await redis.quit()
  } catch {
    // Ignore cleanup errors
  }
}

/** Retry-aware fetch for CI resilience (server may be briefly unresponsive under load) */
export async function fetchRetry(
  url: string,
  init?: RequestInit,
  retries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('unreachable')
}

/** Simple HTTP helper */
export async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetchRetry(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

/** Create a WebSocket connection and wait for open */
export function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('WS connect timeout')), 5000)
  })
}

/** Send a WS message and wait for a specific response type */
export function wsSendAndWait(
  ws: WebSocket,
  msg: object,
  expectedType: string,
  timeoutMs = 10000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for ${expectedType}`)),
      timeoutMs,
    )

    const handler = (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === expectedType) {
          clearTimeout(timeout)
          ws.off('message', handler)
          resolve(parsed)
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.on('message', handler)
    ws.send(JSON.stringify(msg))
  })
}

/** Wait for a specific WS message type without sending */
export function wsWaitFor(ws: WebSocket, expectedType: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for ${expectedType}`)),
      timeoutMs,
    )

    const handler = (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === expectedType) {
          clearTimeout(timeout)
          ws.off('message', handler)
          resolve(parsed)
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.on('message', handler)
  })
}

/** Collect all messages of a specific type for a duration */
export function wsCollect(ws: WebSocket, expectedType: string, durationMs = 1000): Promise<any[]> {
  return new Promise((resolve) => {
    const results: any[] = []
    const handler = (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === expectedType) results.push(parsed)
      } catch {
        /* ignore */
      }
    }
    ws.on('message', handler)
    setTimeout(() => {
      ws.off('message', handler)
      resolve(results)
    }, durationMs)
  })
}

let _adminToken: string | null = null

/** Get admin access token (cached per test run) */
async function getAdminToken(): Promise<string> {
  if (_adminToken) return _adminToken
  const res = await api('POST', '/api/auth/login', {
    username: 'admin',
    password: 'AdminPass123',
  })
  if (!res.data?.ok) throw new Error(`Admin login failed: ${res.data?.error}`)
  _adminToken = res.data.data.accessToken
  return _adminToken!
}

/** Create a test user via admin API and return their tokens */
export async function registerUser(
  username: string,
  password = 'TestPass123',
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const adminToken = await getAdminToken()
  const createRes = await api('POST', '/api/users', { username, password }, adminToken)
  if (!createRes.data?.ok) throw new Error(`Create user failed: ${createRes.data?.error}`)

  // Login as the new user to get their tokens
  const loginRes = await api('POST', '/api/auth/login', { username, password })
  if (!loginRes.data?.ok) throw new Error(`Login failed: ${loginRes.data?.error}`)
  return {
    userId: loginRes.data.data.user.id,
    accessToken: loginRes.data.data.accessToken,
    refreshToken: loginRes.data.data.refreshToken,
  }
}

/** Reset cached admin token (call in stopServer) */
function resetAdminToken() {
  _adminToken = null
}
