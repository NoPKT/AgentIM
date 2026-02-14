import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import pg from 'pg'
import WebSocket from 'ws'

let serverProcess: ChildProcess | null = null
let testDbName: string | null = null

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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Server startup timeout'))
    }, 15000)

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (text.includes('running at') && !started) {
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

  // Flush test Redis DB
  try {
    const { default: Redis } = await import('ioredis')
    const redis = new Redis(REDIS_URL)
    await redis.flushdb()
    await redis.quit()
  } catch {
    // Ignore cleanup errors
  }
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

  const res = await fetch(`${BASE_URL}${path}`, {
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
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeoutMs)

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

/** Register a test user and return tokens */
export async function registerUser(
  username: string,
  password = 'testpass123',
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const res = await api('POST', '/api/auth/register', { username, password })
  if (!res.data?.ok) throw new Error(`Register failed: ${res.data?.error}`)
  return {
    userId: res.data.data.user.id,
    accessToken: res.data.data.accessToken,
    refreshToken: res.data.data.refreshToken,
  }
}
