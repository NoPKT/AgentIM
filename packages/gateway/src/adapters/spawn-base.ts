import { spawn, type ChildProcess } from 'node:child_process'
import { MAX_BUFFER_SIZE } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
} from './base.js'
import { createLogger } from '../lib/logger.js'

const envLog = createLogger('EnvFilter')

const MAX_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours hard cap
const MAX_ABSOLUTE_TIMEOUT_MS = 4 * 60 * 60 * 1000 // 4 hours hard cap

const PROCESS_TIMEOUT_MS = Math.min(
  MAX_PROCESS_TIMEOUT_MS,
  Math.max(30_000, parseInt(process.env.AGENTIM_PROCESS_TIMEOUT_MS ?? '', 10) || 5 * 60 * 1000),
) // default 5 minutes, min 30s, max 2h

const ABSOLUTE_TIMEOUT_MS = Math.min(
  MAX_ABSOLUTE_TIMEOUT_MS,
  Math.max(60_000, parseInt(process.env.AGENTIM_ABSOLUTE_TIMEOUT_MS ?? '', 10) || 15 * 60 * 1000),
) // default 15 minutes, min 1m, max 4h
const STDERR_MAX_BUFFER_SIZE = 5 * 1024 * 1024 // 5 MB

/**
 * Sensitive env var prefixes/names stripped before passing to child processes.
 * Prevents leaking DB credentials, JWT secrets, etc. to AI agent subprocesses.
 */
const SENSITIVE_ENV_KEYS = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'ADMIN_PASSWORD',
  'AGENTIM_PASSWORD',
  'AGENTIM_TOKEN',
  'ENCRYPTION_KEY',
  'SENTRY_DSN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_APP_PRIVATE_KEY',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'HUGGINGFACE_TOKEN',
  'HUGGINGFACE_API_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'VAPID_PRIVATE_KEY',
  'PGPASSWORD',
  'MYSQL_PWD',
  'PRIVATE_KEY',
  'SIGNING_KEY',
  'SESSION_SECRET',
  'WEBHOOK_SECRET',
  'VAULT_TOKEN',
  'CONSUL_TOKEN',
])

const SENSITIVE_ENV_PREFIXES = [
  'ROUTER_LLM_',
  'AGENTIM_SECRET_',
  'SECRET_',
  'API_KEY_',
  'STRIPE_',
  'GITHUB_APP_',
  'PASSWORD_',
  'PRIVATE_KEY_',
  'WEBHOOK_',
  'DATABASE_',
  'REDIS_',
  'VAULT_',
  'CONSUL_',
  'AUTH_TOKEN_',
  'TOKEN_',
]

/**
 * Server infrastructure secrets that must NEVER be passed to child agent processes,
 * regardless of any user-configured passEnv whitelist.
 */
const NEVER_PASSABLE_KEYS = new Set([
  'JWT_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
  'ADMIN_PASSWORD',
  'ENCRYPTION_KEY',
  'SENTRY_DSN',
  'SESSION_SECRET',
])

/**
 * Return a copy of process.env with sensitive variables removed.
 * @param passEnv - Optional whitelist of env var names to pass through despite being sensitive.
 *                  Keys in NEVER_PASSABLE_KEYS are always stripped and cannot be overridden.
 */
export function getSafeEnv(passEnv?: Set<string>): Record<string, string | undefined> {
  // Warn about any never-passable keys the user tried to whitelist
  if (passEnv) {
    for (const key of passEnv) {
      if (NEVER_PASSABLE_KEYS.has(key)) {
        envLog.warn(`passEnv contains never-passable key "${key}" — it will be stripped regardless`)
      }
    }
  }

  const env = { ...process.env }
  const filtered: string[] = []
  for (const key of Object.keys(env)) {
    if (SENSITIVE_ENV_KEYS.has(key) || SENSITIVE_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      if (passEnv?.has(key) && !NEVER_PASSABLE_KEYS.has(key)) continue
      delete env[key]
      filtered.push(key)
    }
  }
  if (filtered.length > 0) {
    envLog.debug(`Filtered ${filtered.length} sensitive env var(s): ${filtered.join(', ')}`)
  }
  return env
}

/**
 * Redact sensitive patterns (API keys, tokens, local paths) from stderr output
 * before relaying to the hub.  This prevents accidental credential leaks when
 * a child process prints an API key in an error message.
 */
const SENSITIVE_PATTERNS: [RegExp, string][] = [
  // API key formats: sk-..., key-..., Bearer <token>
  [/\b(sk-[a-zA-Z0-9]{20,})/g, 'sk-••••••'],
  [/\b(key-[a-zA-Z0-9]{20,})/g, 'key-••••••'],
  [/(Bearer\s+)[a-zA-Z0-9._-]{20,}/gi, '$1••••••'],
  [/(Authorization:\s*)[^\s]+/gi, '$1••••••'],
  // Common env var values leaked in error messages
  [/(api[_-]?key|token|secret|password|credential)[\s=:]+\S+/gi, '$1=••••••'],
  // Absolute paths (home dir leak)
  [/\/(?:home|Users)\/[a-zA-Z0-9._-]+/g, '/••••/••••'],
]

export function redactSensitiveContent(text: string): string {
  let result = text
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Base adapter for spawn-based agent integrations.
 * Provides process lifecycle management (timeout, kill escalation, spawnAndStream).
 */
export abstract class SpawnAgentAdapter extends BaseAgentAdapter {
  protected timedOut = false
  private processTimer: ReturnType<typeof setTimeout> | null = null
  private killTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  /** Start a timeout that kills the process if it takes too long */
  protected startProcessTimer(proc: ChildProcess) {
    this.clearProcessTimer()
    this.timedOut = false
    this.processTimer = setTimeout(() => {
      this.timedOut = true
      proc.kill('SIGTERM')
      const escalate = setTimeout(() => {
        try {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill('SIGKILL')
          }
        } catch {
          // Process may have already exited
        }
      }, 5000)
      escalate.unref()
    }, PROCESS_TIMEOUT_MS)
  }

  protected clearProcessTimer() {
    if (this.processTimer) {
      clearTimeout(this.processTimer)
      this.processTimer = null
    }
  }

  /** Gracefully stop a child process with SIGTERM → SIGKILL escalation */
  protected killProcess(proc: ChildProcess) {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
    try {
      proc.kill('SIGTERM')
    } catch {
      // Process may have already exited
    }
    this.killTimer = setTimeout(() => {
      try {
        if (!proc.killed && proc.exitCode === null) {
          proc.kill('SIGKILL')
        }
      } catch {
        // Process may have already exited
      }
      this.killTimer = null
    }, 5000)
    this.killTimer.unref()
  }

  protected clearKillTimer() {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
  }

  /**
   * Spawn a child process and stream its stdout/stderr to callbacks.
   * Shared logic for spawn-based adapters.
   */
  protected spawnAndStream(
    command: string,
    args: string[],
    callbacks: {
      onChunk: ChunkCallback
      onComplete: CompleteCallback
      onError: ErrorCallback
      exitLabel?: string
    },
  ): { proc: ChildProcess; done: () => boolean } {
    const { onChunk, onComplete, onError, exitLabel = command } = callbacks
    let fullContent = ''
    let done = false
    const complete = (content: string) => {
      if (done) return
      done = true
      onComplete(content)
    }
    const fail = (err: string) => {
      if (done) return
      done = true
      onError(err)
    }

    const proc = spawn(command, args, {
      cwd: this.workingDirectory,
      env: { ...getSafeEnv(this.passEnv), ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.startProcessTimer(proc)

    // Absolute timeout that cannot be reset by data chunks
    const absoluteTimer = setTimeout(() => {
      if (done) return
      this.timedOut = true
      this.clearProcessTimer()
      this.isRunning = false
      fail(
        `Process exceeded absolute timeout (${Math.round(ABSOLUTE_TIMEOUT_MS / 60_000)} minutes)`,
      )
      this.killProcess(proc)
    }, ABSOLUTE_TIMEOUT_MS)
    absoluteTimer.unref()

    let stderrSize = 0

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullContent += text
      if (fullContent.length > MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        clearTimeout(absoluteTimer)
        this.isRunning = false
        fail('Response too large')
        this.killProcess(proc)
        return
      }
      onChunk({ type: 'text', content: text })
      this.startProcessTimer(proc)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      if (done) return
      stderrSize += data.length
      if (stderrSize > STDERR_MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        clearTimeout(absoluteTimer)
        this.isRunning = false
        fail('Stderr output too large (exceeded 5MB)')
        this.killProcess(proc)
        return
      }
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: redactSensitiveContent(text) })
      // Reset process timer on stderr activity (agent is still working)
      this.startProcessTimer(proc)
    })

    proc.on('close', (code) => {
      this.clearProcessTimer()
      clearTimeout(absoluteTimer)
      this.isRunning = false
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      if (this.timedOut) {
        fail('Process timed out')
      } else if (code === 0) {
        complete(fullContent)
      } else if (code === null) {
        fail('Process killed by signal')
      } else {
        fail(`${exitLabel} exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.clearProcessTimer()
      clearTimeout(absoluteTimer)
      this.isRunning = false
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        fail(
          `Command "${command}" not found. Please ensure it is installed and available in your PATH.`,
        )
      } else {
        fail(err.message)
      }
    })

    return { proc, done: () => done }
  }
}
