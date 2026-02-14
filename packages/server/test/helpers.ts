import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

let serverProcess: ChildProcess | null = null
let tempDir: string | null = null

export const TEST_PORT = 3999
export const BASE_URL = `http://localhost:${TEST_PORT}`
export const WS_CLIENT_URL = `ws://localhost:${TEST_PORT}/ws/client`
export const WS_GATEWAY_URL = `ws://localhost:${TEST_PORT}/ws/gateway`

export async function startServer(): Promise<void> {
  tempDir = mkdtempSync(join(tmpdir(), 'aim-test-'))
  const dbPath = join(tempDir, 'test.db')

  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATABASE_PATH: dbPath,
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
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    tempDir = null
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
