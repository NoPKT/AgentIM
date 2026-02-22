import { spawn, type ChildProcess } from 'node:child_process'
import { MAX_BUFFER_SIZE } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
} from './base.js'

const PROCESS_TIMEOUT_MS = Math.max(
  30_000,
  parseInt(process.env.AGENTIM_PROCESS_TIMEOUT_MS ?? '', 10) || 5 * 60 * 1000,
) // default 5 minutes, minimum 30 seconds

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
])

const SENSITIVE_ENV_PREFIXES = [
  'ROUTER_LLM_',
  'AGENTIM_SECRET_',
  'SECRET_',
  'API_KEY_',
  'STRIPE_',
  'GITHUB_APP_',
]

/** Return a copy of process.env with sensitive variables removed. */
export function getSafeEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (SENSITIVE_ENV_KEYS.has(key) || SENSITIVE_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      delete env[key]
    }
  }
  return env
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
          proc.kill('SIGKILL')
        } catch {}
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
    proc.kill('SIGTERM')
    this.killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {}
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
      env: getSafeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    this.startProcessTimer(proc)

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullContent += text
      if (fullContent.length > MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        this.isRunning = false
        fail('Response too large')
        this.killProcess(proc)
        return
      }
      onChunk({ type: 'text', content: text })
    })

    proc.stderr?.on('data', (data: Buffer) => {
      if (done) return
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: text })
    })

    proc.on('close', (code) => {
      this.clearProcessTimer()
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
